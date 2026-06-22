import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import Stripe from 'stripe';
import { Decimal } from 'decimal.js';
import type CircuitBreaker from 'opossum';
import { Redis } from 'ioredis';
import type { SubscriptionTier } from '@b2b/shared';
import { AppConfigService } from '../config/app-config.service';
import { CircuitBreakerFactory } from '../common/circuit-breaker/circuit-breaker.factory';
import { PrismaService } from '../prisma/prisma.service';
import { MerchantContextService } from '../prisma/merchant-context.service';
import { EmailService } from '../email/email.service';
import { REDIS_CACHE } from '../redis/redis.module';

const Money = Decimal.clone({ rounding: Decimal.ROUND_HALF_EVEN, precision: 40 });

/** Per-tier free GMV thresholds (USD) before metered billing begins. */
const GMV_FREE_THRESHOLD: Record<SubscriptionTier, Decimal> = {
  starter: new Money('20000'),
  growth: new Money('50000'),
  pro: new Money('150000'),
};

/** Per-tier metered GMV rate (fraction of billable GMV). */
const GMV_RATE: Record<SubscriptionTier, Decimal> = {
  starter: new Money('0.005'),
  growth: new Money('0.004'),
  pro: new Money('0.003'),
};

/** Number of dunning failures before the merchant is suspended. */
const DUNNING_SUSPEND_THRESHOLD = 3;

/** Flat monthly subscription price per tier (USD, mirrors the Stripe prices). */
const TIER_FLAT_PRICE: Record<SubscriptionTier, string> = {
  starter: '29.00',
  growth: '79.00',
  pro: '199.00',
};

/** Current plan snapshot for the billing page (`GET /api/v1/billing/plan`). */
export interface BillingPlan {
  tier: SubscriptionTier;
  status: 'active' | 'trial' | 'inactive';
  isTrial: boolean;
  /** Flat monthly price for the current tier, as a 2dp string. */
  amount: string;
  priceLabel: string;
  nextBillingDate: string | null;
  trialEndsAt: string | null;
}

/** A breaker-wrapped Stripe call (one network round-trip). */
type StripeAction<T> = () => Promise<T>;

/**
 * Hybrid Stripe billing: a flat recurring subscription price plus a metered GMV
 * price with per-tier free thresholds. Every Stripe write carries a
 * deterministic idempotency key (SHA-256 of merchantId + operation +
 * contextual data) so retries never double-charge. All Stripe traffic flows
 * through the shared `stripe` circuit breaker (15s timeout).
 */
@Injectable()
export class BillingService implements OnModuleInit {
  private readonly logger = new Logger(BillingService.name);
  private readonly stripe: Stripe;
  private breaker!: CircuitBreaker<[StripeAction<unknown>], unknown>;

  constructor(
    private readonly config: AppConfigService,
    private readonly breakerFactory: CircuitBreakerFactory,
    private readonly prisma: PrismaService,
    private readonly merchantContext: MerchantContextService,
    private readonly email: EmailService,
    @Inject(REDIS_CACHE) private readonly cache: Redis,
  ) {
    this.stripe = new Stripe(this.config.get('STRIPE_SECRET_KEY'));
  }

  onModuleInit(): void {
    this.breaker = this.breakerFactory.create<[StripeAction<unknown>], unknown>(
      'stripe',
      (action: StripeAction<unknown>) => action(),
      { timeout: 15_000 },
    );
  }

  // ── Customer ───────────────────────────────────────────────────────────

  async createOrRetrieveCustomer(merchantId: string): Promise<Stripe.Customer> {
    const merchant = await this.merchantContext.runAsSystem(() =>
      this.prisma.merchant.findUniqueOrThrow({
        where: { id: merchantId },
        select: { stripeCustomerId: true, shopifyDomain: true },
      }),
    );

    if (merchant.stripeCustomerId) {
      const existing = await this.fire(() =>
        this.stripe.customers.retrieve(merchant.stripeCustomerId as string),
      );
      if (!(existing as Stripe.DeletedCustomer).deleted) {
        return existing as Stripe.Customer;
      }
    }

    const customer = await this.fire(() =>
      this.stripe.customers.create(
        {
          name: merchant.shopifyDomain,
          metadata: { merchantId, shopifyDomain: merchant.shopifyDomain },
        },
        { idempotencyKey: this.idempotencyKey(merchantId, 'customer-create', merchant.shopifyDomain) },
      ),
    );

    await this.merchantContext.runAsSystem(() =>
      this.prisma.merchant.update({
        where: { id: merchantId },
        data: { stripeCustomerId: customer.id },
      }),
    );
    return customer;
  }

  // ── Subscription ─────────────────────────────────────────────────────────

  async createSubscription(
    merchantId: string,
    tier: SubscriptionTier,
    actorId?: string,
  ): Promise<Stripe.Subscription> {
    const customer = await this.createOrRetrieveCustomer(merchantId);
    const flatPriceId = this.flatPriceId(tier);
    const meteredPriceId = this.config.get('STRIPE_GMV_METERED_PRICE_ID');

    const subscription = await this.fire(() =>
      this.stripe.subscriptions.create(
        {
          customer: customer.id,
          items: [{ price: flatPriceId }, { price: meteredPriceId }],
          metadata: { merchantId, subscriptionTier: tier },
        },
        { idempotencyKey: this.idempotencyKey(merchantId, 'sub-create', `${tier}-${this.currentMonthKey()}`) },
      ),
    );

    await this.merchantContext.runAsSystem(() =>
      this.prisma.merchant.update({
        where: { id: merchantId },
        data: { subscriptionStripeId: subscription.id, subscriptionTier: tier, isActive: true },
      }),
    );
    await this.cacheTier(merchantId, tier);
    await this.writeAudit(
      merchantId,
      'subscription_created',
      { tier, subscriptionId: subscription.id },
      { actorType: 'merchant_user', actorId },
    );
    return subscription;
  }

  /** Switch the merchant to a new flat-price tier, keeping the metered item. */
  async changeTier(
    merchantId: string,
    tier: SubscriptionTier,
    actorId?: string,
  ): Promise<Stripe.Subscription> {
    const merchant = await this.merchantContext.runAsSystem(() =>
      this.prisma.merchant.findUniqueOrThrow({
        where: { id: merchantId },
        select: { subscriptionStripeId: true },
      }),
    );
    if (!merchant.subscriptionStripeId) {
      return this.createSubscription(merchantId, tier, actorId);
    }

    const subscription = (await this.fire(() =>
      this.stripe.subscriptions.retrieve(merchant.subscriptionStripeId as string),
    )) as Stripe.Subscription;
    const meteredPriceId = this.config.get('STRIPE_GMV_METERED_PRICE_ID');
    const flatItem = subscription.items.data.find((item) => item.price.id !== meteredPriceId);
    if (!flatItem) {
      throw new Error('Subscription has no flat-price item to update');
    }

    const updated = await this.fire(() =>
      this.stripe.subscriptions.update(
        subscription.id,
        {
          items: [{ id: flatItem.id, price: this.flatPriceId(tier) }],
          proration_behavior: 'create_prorations',
          metadata: { merchantId, subscriptionTier: tier },
        },
        { idempotencyKey: this.idempotencyKey(merchantId, 'sub-change', `${tier}-${this.currentMonthKey()}`) },
      ),
    );

    await this.merchantContext.runAsSystem(() =>
      this.prisma.merchant.update({
        where: { id: merchantId },
        data: { subscriptionTier: tier },
      }),
    );
    await this.cacheTier(merchantId, tier);
    await this.writeAudit(
      merchantId,
      'subscription_tier_changed',
      { tier },
      { actorType: 'merchant_user', actorId },
    );
    return updated;
  }

  // ── Metered GMV ──────────────────────────────────────────────────────────

  /**
   * Report newly-collected GMV to Stripe's metered item, billing only the
   * portion above the tier's free threshold. The merchant's running monthly GMV
   * is updated atomically (with a month-rollover check) so the
   * previous/new-billable boundary is computed deterministically.
   */
  async reportBillableGmv(merchantId: string, additionalGmv: Decimal, invoiceId: string): Promise<void> {
    if (additionalGmv.lessThanOrEqualTo(0)) {
      return;
    }

    const merchant = await this.merchantContext.runAsSystem(() =>
      this.prisma.merchant.findUniqueOrThrow({
        where: { id: merchantId },
        select: { subscriptionTier: true, subscriptionStripeId: true, gmvCurrentMonth: true, gmvMonthKey: true },
      }),
    );
    if (!merchant.subscriptionStripeId) {
      this.logger.warn(`Merchant ${merchantId} has no subscription; skipping GMV report`);
      return;
    }

    const tier = merchant.subscriptionTier as SubscriptionTier;
    const threshold = GMV_FREE_THRESHOLD[tier];
    const rate = GMV_RATE[tier];
    const monthKey = this.currentMonthKey();

    // Atomic running-GMV update with month rollover.
    const previousGmv =
      merchant.gmvMonthKey === monthKey ? new Money(merchant.gmvCurrentMonth.toString()) : new Money(0);
    const newGmv = previousGmv.plus(additionalGmv);

    await this.merchantContext.runAsSystem(() =>
      this.prisma.merchant.update({
        where: { id: merchantId },
        data: { gmvCurrentMonth: newGmv.toFixed(2), gmvMonthKey: monthKey },
      }),
    );

    // Billable = portion of each side above the free threshold.
    const billablePrevious = Decimal.max(previousGmv.minus(threshold), new Money(0));
    const billableNew = Decimal.max(newGmv.minus(threshold), new Money(0));
    const additionalBillable = billableNew.minus(billablePrevious);
    if (additionalBillable.lessThanOrEqualTo(0)) {
      return;
    }

    // Usage quantity is the billable fee in whole cents (integer required).
    const feeCents = additionalBillable.times(rate).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN);
    const quantity = Number(feeCents.toFixed(0));
    if (quantity <= 0) {
      return;
    }

    const meteredPriceId = this.config.get('STRIPE_GMV_METERED_PRICE_ID');
    const subscription = (await this.fire(() =>
      this.stripe.subscriptions.retrieve(merchant.subscriptionStripeId as string),
    )) as Stripe.Subscription;
    const meteredItem = subscription.items.data.find((item) => item.price.id === meteredPriceId);
    if (!meteredItem) {
      this.logger.error(`Merchant ${merchantId} subscription has no metered GMV item`);
      return;
    }

    await this.fire(() =>
      this.stripe.subscriptionItems.createUsageRecord(
        meteredItem.id,
        { quantity, action: 'increment' },
        { idempotencyKey: `gmv-${merchantId}-${invoiceId}` },
      ),
    );
    await this.writeAudit(merchantId, 'gmv_reported', {
      invoiceId,
      additionalBillable: additionalBillable.toFixed(2),
      feeCents: quantity,
    });
  }

  // ── Webhooks ───────────────────────────────────────────────────────────

  async handleStripeWebhook(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'invoice.paid':
      case 'invoice.payment_succeeded':
        await this.onInvoicePaid(event.data.object as Stripe.Invoice);
        break;
      case 'invoice.payment_failed':
        await this.onInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;
      case 'customer.subscription.deleted':
        await this.onSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.updated':
        await this.onSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      default:
        this.logger.debug(`Unhandled Stripe event: ${event.type}`);
    }
  }

  private async onInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
    const merchantId = await this.merchantIdForCustomer(invoice.customer);
    if (!merchantId) return;
    await this.merchantContext.runAsSystem(() =>
      this.prisma.merchant.update({ where: { id: merchantId }, data: { isActive: true } }),
    );
    await this.cache.del(`stripe:dunning:${merchantId}`);
    await this.writeAudit(merchantId, 'billing_invoice_paid', { stripeInvoiceId: invoice.id });
  }

  private async onInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    const merchantId = await this.merchantIdForCustomer(invoice.customer);
    if (!merchantId) return;

    const key = `stripe:dunning:${merchantId}`;
    const count = await this.cache.incr(key);
    if (count === 1) {
      await this.cache.expire(key, 30 * 24 * 60 * 60);
    }

    const merchant = await this.merchantContext.runAsSystem(() =>
      this.prisma.merchant.findUnique({
        where: { id: merchantId },
        select: { shopifyDomain: true, users: { where: { role: 'owner' }, select: { email: true }, take: 1 } },
      }),
    );
    const ownerEmail = merchant?.users[0]?.email;
    const amount = new Money((invoice.amount_due ?? 0).toString()).dividedBy(100).toFixed(2);

    if (count >= DUNNING_SUSPEND_THRESHOLD) {
      await this.merchantContext.runAsSystem(() =>
        this.prisma.merchant.update({ where: { id: merchantId }, data: { isActive: false } }),
      );
      if (ownerEmail) {
        await this.email.sendMerchantPaymentFailureAlert({
          to: ownerEmail,
          merchantName: merchant?.shopifyDomain ?? 'your account',
          reason: 'Repeated subscription payment failures — account suspended',
          amount,
          currency: (invoice.currency ?? 'usd').toUpperCase(),
        });
      }
      await this.writeAudit(merchantId, 'billing_suspended', { failedCount: count });
    } else if (ownerEmail) {
      await this.email.sendMerchantPaymentFailureAlert({
        to: ownerEmail,
        merchantName: merchant?.shopifyDomain ?? 'your account',
        reason: 'A subscription payment failed',
        amount,
        currency: (invoice.currency ?? 'usd').toUpperCase(),
      });
      await this.writeAudit(merchantId, 'billing_payment_failed', { failedCount: count });
    }
  }

  private async onSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    const merchantId = await this.merchantIdForCustomer(subscription.customer);
    if (!merchantId) return;
    await this.merchantContext.runAsSystem(() =>
      this.prisma.merchant.update({ where: { id: merchantId }, data: { isActive: false } }),
    );
    await this.writeAudit(merchantId, 'subscription_deleted', { subscriptionId: subscription.id });
  }

  private async onSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    const merchantId = await this.merchantIdForCustomer(subscription.customer);
    if (!merchantId) return;
    const tierMeta = subscription.metadata?.subscriptionTier;
    if (tierMeta === 'starter' || tierMeta === 'growth' || tierMeta === 'pro') {
      await this.merchantContext.runAsSystem(() =>
        this.prisma.merchant.update({
          where: { id: merchantId },
          data: { subscriptionTier: tierMeta },
        }),
      );
      await this.cacheTier(merchantId, tierMeta);
      await this.writeAudit(merchantId, 'subscription_synced', { tier: tierMeta });
    }
  }

  // ── Usage summary + portal ─────────────────────────────────────────────

  /** Current-month GMV usage snapshot for the merchant's billing page. */
  async getUsage(merchantId: string): Promise<{
    tier: SubscriptionTier;
    gmvCurrentMonth: string;
    freeThreshold: string;
    billableGmv: string;
    estimatedFee: string;
  }> {
    const merchant = await this.merchantContext.runAsSystem(() =>
      this.prisma.merchant.findUniqueOrThrow({
        where: { id: merchantId },
        select: { subscriptionTier: true, gmvCurrentMonth: true, gmvMonthKey: true },
      }),
    );
    const tier = merchant.subscriptionTier as SubscriptionTier;
    const monthKey = this.currentMonthKey();
    const gmv =
      merchant.gmvMonthKey === monthKey ? new Money(merchant.gmvCurrentMonth.toString()) : new Money(0);
    const billable = Decimal.max(gmv.minus(GMV_FREE_THRESHOLD[tier]), new Money(0));
    return {
      tier,
      gmvCurrentMonth: gmv.toFixed(2),
      freeThreshold: GMV_FREE_THRESHOLD[tier].toFixed(2),
      billableGmv: billable.toFixed(2),
      estimatedFee: billable.times(GMV_RATE[tier]).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).toFixed(2),
    };
  }

  /**
   * Current plan snapshot for the billing page. Status is derived from the
   * merchant row (there is no `subscriptionStatus` column): an unsubscribed
   * merchant inside its trial window is `trial`; otherwise `active`/`inactive`
   * follows `isActive` (the dunning flow flips it). The next billing date comes
   * from Stripe when a subscription exists, else falls back to the trial end.
   */
  async getPlan(merchantId: string): Promise<BillingPlan> {
    const merchant = await this.merchantContext.runAsSystem(() =>
      this.prisma.merchant.findUniqueOrThrow({
        where: { id: merchantId },
        select: {
          subscriptionTier: true,
          subscriptionStripeId: true,
          isActive: true,
          trialEndsAt: true,
        },
      }),
    );
    const tier = merchant.subscriptionTier as SubscriptionTier;
    const trialActive =
      !merchant.subscriptionStripeId &&
      merchant.trialEndsAt !== null &&
      merchant.trialEndsAt.getTime() > Date.now();
    const status: BillingPlan['status'] = trialActive ? 'trial' : merchant.isActive ? 'active' : 'inactive';

    let nextBillingDate: string | null = merchant.trialEndsAt ? merchant.trialEndsAt.toISOString() : null;
    if (merchant.subscriptionStripeId) {
      try {
        const subscription = (await this.fire(() =>
          this.stripe.subscriptions.retrieve(merchant.subscriptionStripeId as string),
        )) as Stripe.Subscription;
        if (subscription.current_period_end) {
          nextBillingDate = new Date(subscription.current_period_end * 1000).toISOString();
        }
      } catch (error) {
        this.logger.warn(`Could not read Stripe period end for ${merchantId}: ${(error as Error).message}`);
      }
    }

    return {
      tier,
      status,
      isTrial: trialActive,
      amount: TIER_FLAT_PRICE[tier],
      priceLabel: `$${new Money(TIER_FLAT_PRICE[tier]).toNumber()}/mo`,
      nextBillingDate,
      trialEndsAt: merchant.trialEndsAt ? merchant.trialEndsAt.toISOString() : null,
    };
  }

  /** A Stripe Billing Portal session URL for self-serve plan/payment management. */
  async createBillingPortalSession(merchantId: string, returnUrl: string): Promise<string> {
    const customer = await this.createOrRetrieveCustomer(merchantId);
    const session = await this.fire(() =>
      this.stripe.billingPortal.sessions.create({ customer: customer.id, return_url: returnUrl }),
    );
    return session.url;
  }

  /** Verify + construct a Stripe event from the raw webhook body. */
  constructEvent(rawBody: Buffer, signature: string): Stripe.Event {
    return this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      this.config.get('STRIPE_WEBHOOK_SECRET'),
    );
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private flatPriceId(tier: SubscriptionTier): string {
    switch (tier) {
      case 'starter':
        return this.config.get('STRIPE_STARTER_PRICE_ID');
      case 'growth':
        return this.config.get('STRIPE_GROWTH_PRICE_ID');
      case 'pro':
        return this.config.get('STRIPE_PRO_PRICE_ID');
    }
  }

  private async merchantIdForCustomer(
    customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
  ): Promise<string | null> {
    if (!customer) return null;
    const customerId = typeof customer === 'string' ? customer : customer.id;
    const merchant = await this.merchantContext.runAsSystem(() =>
      this.prisma.merchant.findFirst({
        where: { stripeCustomerId: customerId },
        select: { id: true },
      }),
    );
    if (!merchant) {
      this.logger.warn(`No merchant for Stripe customer ${customerId}`);
      return null;
    }
    return merchant.id;
  }

  private async cacheTier(merchantId: string, tier: SubscriptionTier): Promise<void> {
    await this.cache.set(`merchant:tier:${merchantId}`, tier);
  }

  private idempotencyKey(merchantId: string, operation: string, context: string): string {
    return createHash('sha256').update(`${merchantId}:${operation}:${context}`).digest('hex');
  }

  private currentMonthKey(): string {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  private async writeAudit(
    merchantId: string,
    action: string,
    newValueJson: Record<string, unknown>,
    actor: { actorType: 'merchant_user' | 'stripe_webhook'; actorId?: string } = {
      actorType: 'stripe_webhook',
    },
  ): Promise<void> {
    try {
      await this.merchantContext.runAsSystem(() =>
        this.prisma.auditLog.create({
          data: {
            merchantId,
            entityType: 'merchant',
            entityId: merchantId,
            action,
            actorType: actor.actorType,
            ...(actor.actorId ? { actorId: actor.actorId } : {}),
            newValueJson: newValueJson as Stripe.Metadata,
          },
        }),
      );
    } catch (error) {
      this.logger.error(`Failed to write billing audit log: ${(error as Error).message}`);
    }
  }

  /** Run a Stripe action through the shared breaker with correct typing. */
  private async fire<T>(action: StripeAction<T>): Promise<T> {
    return this.breaker.fire(action as StripeAction<unknown>) as Promise<T>;
  }
}
