import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import {
  Paddle,
  Environment,
  EventName,
  ApiError,
  type Customer,
  type EventEntity,
  type SubscriptionNotification,
  type TransactionNotification,
} from "@paddle/paddle-node-sdk";
import { Decimal } from "decimal.js";
import type CircuitBreaker from "opossum";
import { Redis } from "ioredis";
import * as Sentry from "@sentry/node";
import type { SubscriptionTier } from "@b2b/shared";
import { AppConfigService } from "../config/app-config.service";
import { CircuitBreakerFactory } from "../common/circuit-breaker/circuit-breaker.factory";
import { PrismaService } from "../prisma/prisma.service";
import { MerchantContextService } from "../prisma/merchant-context.service";
import { EmailService } from "../email/email.service";
import { REDIS_CACHE, REDIS_QUEUE } from "../redis/redis.module";

const Money = Decimal.clone({
  rounding: Decimal.ROUND_HALF_EVEN,
  precision: 40,
});

/** Per-tier free GMV thresholds (USD) before overage billing begins. */
const GMV_FREE_THRESHOLD: Record<SubscriptionTier, Decimal> = {
  starter: new Money("20000"),
  growth: new Money("50000"),
  pro: new Money("150000"),
};

/** Per-tier GMV overage rate (fraction of billable GMV). */
const GMV_RATE: Record<SubscriptionTier, Decimal> = {
  starter: new Money("0.005"),
  growth: new Money("0.004"),
  pro: new Money("0.003"),
};

/** Number of dunning failures before the merchant is suspended. */
const DUNNING_SUSPEND_THRESHOLD = 3;

/** Flat monthly subscription price per tier (USD, mirrors the Paddle prices). */
const TIER_FLAT_PRICE: Record<SubscriptionTier, string> = {
  starter: "29.00",
  growth: "79.00",
  pro: "199.00",
};

/** Current plan snapshot for the billing page (`GET /api/v1/billing/plan`). */
export interface BillingPlan {
  tier: SubscriptionTier;
  status: "active" | "trial" | "inactive";
  isTrial: boolean;
  /** Flat monthly price for the current tier, as a 2dp string. */
  amount: string;
  priceLabel: string;
  nextBillingDate: string | null;
  trialEndsAt: string | null;
}

/**
 * Result of a tier change: either a hosted-checkout URL (Paddle can't create a
 * subscription server-side, so a first subscribe returns a checkout link) or
 * the newly-applied tier (an existing subscriber is changed in place with
 * immediate proration).
 */
export interface ChangeTierResult {
  checkoutUrl?: string;
  tier?: SubscriptionTier;
}

/** A breaker-wrapped Paddle call (one network round-trip). */
type PaddleAction<T> = () => Promise<T>;

/**
 * True when opossum rejected because the circuit was OPEN — the wrapped call was
 * never invoked (no network round-trip), so no side effect could have occurred.
 * Distinct from a timeout/5xx, where the request may have committed at Paddle.
 * Mirrors the detection in `shopify-api.service.ts`.
 */
function isBreakerOpenError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "EOPENBREAKER"
  );
}

/**
 * Paddle billing (Merchant of Record): a flat recurring subscription price per
 * tier plus one-time GMV overage charges, with per-tier free thresholds. Paddle
 * cannot create a subscription from the server — the first subscribe returns a
 * hosted-checkout URL and the subscription id arrives later via the
 * `subscription.created` webhook. Tier changes for existing subscribers are
 * applied server-side with immediate proration. GMV overage is billed monthly
 * as a single one-time charge against a catalog price. All Paddle traffic flows
 * through the shared `paddle` circuit breaker (15s timeout).
 */
@Injectable()
export class BillingService implements OnModuleInit {
  private readonly logger = new Logger(BillingService.name);
  private readonly paddle: Paddle;
  private breaker!: CircuitBreaker<[PaddleAction<unknown>], unknown>;

  constructor(
    private readonly config: AppConfigService,
    private readonly breakerFactory: CircuitBreakerFactory,
    private readonly prisma: PrismaService,
    private readonly merchantContext: MerchantContextService,
    private readonly email: EmailService,
    @Inject(REDIS_CACHE) private readonly cache: Redis,
    // Dunning failure counters live on the QUEUE Redis (AOF, noeviction), NOT the
    // cache (allkeys-lru): an evicted counter would silently reset the 3-strike
    // suspension. Only the durable dunning set uses this client (§6 MED).
    @Inject(REDIS_QUEUE) private readonly persistentRedis: Redis,
  ) {
    this.paddle = new Paddle(this.config.get("PADDLE_API_KEY"), {
      environment:
        this.config.get("PADDLE_ENV") === "production"
          ? Environment.production
          : Environment.sandbox,
    });
  }

  onModuleInit(): void {
    this.breaker = this.breakerFactory.create<[PaddleAction<unknown>], unknown>(
      "paddle",
      (action: PaddleAction<unknown>) => action(),
      {
        timeout: 15_000,
        // A Paddle ApiError means Paddle RESPONDED (it is reachable) — a
        // business/validation error such as customer_already_exists or a
        // not-found is not an outage and must not count toward tripping the
        // shared breaker open. Only timeouts and network failures (which are
        // not ApiError) should open it.
        errorFilter: (error) => error instanceof ApiError,
      },
    );
  }

  // ── Customer ───────────────────────────────────────────────────────────

  async createOrRetrieveCustomer(merchantId: string): Promise<Customer> {
    const merchant = await this.merchantContext.runAsSystem(() =>
      this.prisma.merchant.findUniqueOrThrow({
        where: { id: merchantId },
        select: {
          paddleCustomerId: true,
          shopifyDomain: true,
          users: { where: { role: "owner" }, select: { email: true }, take: 1 },
        },
      }),
    );

    if (merchant.paddleCustomerId) {
      const existing = await this.fire(() =>
        this.paddle.customers.get(merchant.paddleCustomerId as string),
      );
      if (existing.status !== "archived") {
        return existing;
      }
    }

    // Paddle requires an email to create a customer; fall back to a
    // domain-derived address if the owner user has no email on file.
    const email =
      merchant.users[0]?.email ?? `billing@${merchant.shopifyDomain}`;

    const customer = await this.createCustomerReusingOnConflict(
      merchantId,
      email,
      merchant.shopifyDomain,
    );

    await this.merchantContext.runAsSystem(() =>
      this.prisma.merchant.update({
        where: { id: merchantId },
        data: { paddleCustomerId: customer.id },
      }),
    );
    return customer;
  }

  /**
   * Create a Paddle customer, or reuse the existing one when Paddle reports the
   * email already belongs to a customer (`customer_already_exists`) — this makes
   * customer creation idempotent across retries where `paddleCustomerId` was
   * never persisted.
   */
  private async createCustomerReusingOnConflict(
    merchantId: string,
    email: string,
    shopifyDomain: string,
  ): Promise<Customer> {
    try {
      return await this.fire(() =>
        this.paddle.customers.create({
          email,
          name: shopifyDomain,
          customData: { merchantId, shopifyDomain },
        }),
      );
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === "customer_already_exists"
      ) {
        const [existing] = await this.fire(() =>
          this.paddle.customers.list({ email: [email] }).next(),
        );
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
  }

  // ── Subscription / checkout ──────────────────────────────────────────────

  /**
   * Return a hosted Paddle checkout URL for a first subscription to `tier`. The
   * subscription itself is created by Paddle once the merchant pays; its id
   * arrives via the `subscription.created` webhook (nothing is persisted here).
   */
  async createCheckoutForTier(
    merchantId: string,
    tier: SubscriptionTier,
    actorId?: string,
  ): Promise<string> {
    const customer = await this.createOrRetrieveCustomer(merchantId);
    const transaction = await this.fire(() =>
      this.paddle.transactions.create({
        items: [{ priceId: this.flatPriceId(tier), quantity: 1 }],
        customerId: customer.id,
        customData: { merchantId, subscriptionTier: tier },
      }),
    );
    await this.writeAudit(
      merchantId,
      "billing_checkout_created",
      { tier, transactionId: transaction.id },
      { actorType: "merchant_user", actorId },
    );
    return `${this.config.get("PADDLE_CHECKOUT_URL")}?_ptxn=${transaction.id}`;
  }

  /**
   * Switch the merchant to a new flat-price tier. An existing subscriber is
   * changed in place with immediate proration (returns `{ tier }`); a merchant
   * with no Paddle subscription yet is sent to hosted checkout (returns
   * `{ checkoutUrl }`).
   */
  async changeTier(
    merchantId: string,
    tier: SubscriptionTier,
    actorId?: string,
  ): Promise<ChangeTierResult> {
    const merchant = await this.merchantContext.runAsSystem(() =>
      this.prisma.merchant.findUniqueOrThrow({
        where: { id: merchantId },
        select: { subscriptionPaddleId: true },
      }),
    );
    if (!merchant.subscriptionPaddleId) {
      return {
        checkoutUrl: await this.createCheckoutForTier(
          merchantId,
          tier,
          actorId,
        ),
      };
    }

    await this.fire(() =>
      this.paddle.subscriptions.update(
        merchant.subscriptionPaddleId as string,
        {
          items: [{ priceId: this.flatPriceId(tier), quantity: 1 }],
          prorationBillingMode: "prorated_immediately",
          customData: { merchantId, subscriptionTier: tier },
        },
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
      "subscription_tier_changed",
      { tier },
      { actorType: "merchant_user", actorId },
    );
    return { tier };
  }

  // ── GMV overage ──────────────────────────────────────────────────────────

  /**
   * Monthly job (03:00 UTC on the 1st): charge every active subscriber their
   * closed-month GMV overage as a single Paddle one-time charge. Each merchant
   * is isolated — one failure is Sentry-captured and never blocks the others.
   */
  @Cron("0 3 1 * *")
  async chargeAllMerchantsGmvOverage(): Promise<{ chargedCount: number }> {
    const monthKey = this.previousMonthKey();
    const merchants = await this.merchantContext.runAsSystem(() =>
      this.prisma.merchant.findMany({
        where: { subscriptionPaddleId: { not: null }, isActive: true },
        select: { id: true },
      }),
    );

    let chargedCount = 0;
    for (const merchant of merchants) {
      try {
        const charged = await this.chargeMonthlyGmvOverage(
          merchant.id,
          monthKey,
        );
        if (charged) {
          chargedCount += 1;
        }
      } catch (error) {
        Sentry.captureException(error, {
          level: "error",
          tags: { component: "billing", job: "gmv_overage" },
          extra: { merchantId: merchant.id, monthKey },
        });
        this.logger.error(
          `GMV overage charge failed for ${merchant.id} (${monthKey}): ${(error as Error).message}`,
        );
      }
    }
    if (chargedCount > 0) {
      this.logger.log(
        `GMV overage: charged ${chargedCount} merchant(s) for ${monthKey}`,
      );
    }
    return { chargedCount };
  }

  /**
   * Charge one merchant's billable GMV overage for `monthKey` (format
   * `YYYY-MM`) as a Paddle one-time charge against the catalog GMV price (unit =
   * 1 cent, so `quantity` is the fee in whole cents).
   *
   * The month's GMV is read from the immutable {@link MerchantMonthlyGmv} ledger
   * row — NOT the mutable `merchants.gmv_current_month` running bucket, which the
   * first payment of the new month overwrites at rollover (that race silently
   * skipped billing for closed months). Idempotency is an atomic compare-and-set
   * on `chargedAt` (NULL→now()) taken BEFORE the Paddle call, so a re-run /
   * redelivery / concurrent pod can never double-charge. The latch is released
   * for retry ONLY when the charge provably never reached Paddle (circuit breaker
   * open); an ambiguous failure (timeout / 5xx / network) keeps the latch set and
   * is surfaced for reconciliation, because a released latch plus a
   * possibly-committed charge is exactly what double-bills on retry (the
   * one-time-charge POST is non-idempotent and the pinned SDK exposes no
   * idempotency key). Returns `true` when a charge was issued.
   */
  async chargeMonthlyGmvOverage(
    merchantId: string,
    monthKey: string,
  ): Promise<boolean> {
    const merchant = await this.merchantContext.runAsSystem(() =>
      this.prisma.merchant.findUniqueOrThrow({
        where: { id: merchantId },
        select: { subscriptionTier: true, subscriptionPaddleId: true },
      }),
    );
    if (!merchant.subscriptionPaddleId) {
      this.logger.warn(
        `Merchant ${merchantId} has no subscription; skipping GMV overage`,
      );
      return false;
    }

    const ledger = await this.merchantContext.runAsSystem(() =>
      this.prisma.merchantMonthlyGmv.findUnique({
        where: { merchantId_monthKey: { merchantId, monthKey } },
        select: { gmv: true, chargedAt: true },
      }),
    );
    // No ledger row → no accrued GMV that month.
    if (!ledger) {
      return false;
    }
    if (ledger.chargedAt) {
      this.logger.warn(
        `GMV overage already charged for ${merchantId} (${monthKey}); skipping`,
      );
      return false;
    }

    const tier = merchant.subscriptionTier as SubscriptionTier;
    const gmv = new Money(ledger.gmv.toString());
    const billable = Decimal.max(
      gmv.minus(GMV_FREE_THRESHOLD[tier]),
      new Money(0),
    );
    if (billable.lessThanOrEqualTo(0)) {
      return false;
    }

    // Fee in whole cents (catalog price unit = 1 cent → quantity = cents).
    const feeCents = billable
      .times(GMV_RATE[tier])
      .times(100)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN);
    const quantity = Number(feeCents.toFixed(0));
    if (quantity <= 0) {
      return false;
    }

    // Atomic idempotency latch: exactly one caller flips chargedAt NULL→now().
    // A conditional updateMany is a compare-and-set — count 0 means another
    // run/pod already claimed (or completed) this month, so we must not charge.
    const claim = await this.merchantContext.runAsSystem(() =>
      this.prisma.merchantMonthlyGmv.updateMany({
        where: { merchantId, monthKey, chargedAt: null },
        data: { chargedAt: new Date(), feeCents: quantity },
      }),
    );
    if (claim.count === 0) {
      this.logger.warn(
        `GMV overage already claimed for ${merchantId} (${monthKey}); skipping`,
      );
      return false;
    }

    let chargeId: string | null = null;
    try {
      const charge = (await this.fire(() =>
        this.paddle.subscriptions.createOneTimeCharge(
          merchant.subscriptionPaddleId as string,
          {
            effectiveFrom: "immediately",
            items: this.gmvChargeItems(quantity),
          },
        ),
      )) as { id?: string } | null;
      chargeId = charge?.id ?? null;
    } catch (error) {
      if (isBreakerOpenError(error)) {
        // Circuit open → the request never reached Paddle, so no charge exists.
        // Safe to release the latch so a later run can retry this month.
        await this.merchantContext
          .runAsSystem(() =>
            this.prisma.merchantMonthlyGmv.updateMany({
              where: { merchantId, monthKey },
              data: { chargedAt: null, feeCents: null },
            }),
          )
          .catch((releaseError) => {
            // Latch stuck set but the charge did NOT happen — surface so the
            // month is reconciled rather than silently never billed.
            Sentry.captureException(releaseError, {
              level: "error",
              tags: { component: "billing", job: "gmv_overage_release" },
              extra: { merchantId, monthKey },
            });
          });
      } else {
        // Ambiguous failure (timeout / 5xx / network drop): Paddle may already
        // have committed the charge. Do NOT release the latch — that plus a
        // committed charge is what double-bills on retry. Keep it claimed and
        // flag for manual reconciliation against Paddle.
        Sentry.captureException(error, {
          level: "error",
          tags: { component: "billing", job: "gmv_overage_reconcile" },
          extra: { merchantId, monthKey, feeCents: quantity, ambiguous: true },
        });
      }
      throw error;
    }

    // Anchor the successful charge to the ledger row so a later reconciliation can
    // prove this month was billed and by which Paddle charge.
    if (chargeId) {
      await this.merchantContext
        .runAsSystem(() =>
          this.prisma.merchantMonthlyGmv.updateMany({
            where: { merchantId, monthKey },
            data: { paddleChargeId: chargeId },
          }),
        )
        .catch(() => undefined);
    }

    await this.writeAudit(
      merchantId,
      "gmv_charged",
      {
        monthKey,
        billableGmv: billable.toFixed(2),
        feeCents: quantity,
        paddleChargeId: chargeId,
      },
      { actorType: "system" },
    );
    return true;
  }

  /**
   * Split a whole-cent fee into Paddle line items, each capped at Paddle's
   * per-line-item quantity ceiling (1,000,000). Without this a monthly overage
   * fee above $10,000 (quantity > 1e6) would be rejected outright.
   */
  private gmvChargeItems(
    quantity: number,
  ): { priceId: string; quantity: number }[] {
    const priceId = this.config.get("PADDLE_GMV_PRICE_ID");
    const MAX_LINE_QUANTITY = 1_000_000;
    const items: { priceId: string; quantity: number }[] = [];
    let remaining = quantity;
    while (remaining > 0) {
      const chunk = Math.min(remaining, MAX_LINE_QUANTITY);
      items.push({ priceId, quantity: chunk });
      remaining -= chunk;
    }
    return items;
  }

  // ── Webhooks ───────────────────────────────────────────────────────────

  async handleWebhook(event: EventEntity): Promise<void> {
    const entityId = (event.data as { id?: string } | undefined)?.id ?? null;
    const occurredAt = event.occurredAt ? new Date(event.occurredAt) : null;

    // Idempotency (HIGH): Paddle delivers at-least-once with no ordering
    // guarantee. Record the event id exactly once BEFORE processing — a
    // redelivery collides on the unique index and is skipped, so a handler never
    // re-runs (no duplicate audit rows, no repeated state mutation).
    const firstDelivery = await this.recordPaddleEvent(
      event.eventId,
      event.eventType,
      entityId,
      occurredAt,
    );
    if (!firstDelivery) {
      this.logger.log(
        `Duplicate Paddle event ${event.eventId} (${event.eventType}); skipping`,
      );
      return;
    }

    // Ordering guard (HIGH): subscription events mutate merchants.is_active, so a
    // STALE out-of-order delivery must not clobber newer state. Skip a
    // subscription event when a newer event for the same subscription has already
    // been recorded. Transaction events are not order-sensitive here.
    const isSubscriptionEvent =
      event.eventType === EventName.SubscriptionCreated ||
      event.eventType === EventName.SubscriptionUpdated ||
      event.eventType === EventName.SubscriptionCanceled;
    if (
      isSubscriptionEvent &&
      entityId &&
      occurredAt &&
      (await this.isSupersededByNewerEvent(entityId, occurredAt, event.eventId))
    ) {
      this.logger.log(
        `Stale Paddle event ${event.eventId} (${event.eventType}) for ${entityId}; a newer event already applied — skipping`,
      );
      return;
    }

    switch (event.eventType) {
      case EventName.SubscriptionCreated:
        await this.onSubscriptionCreated(
          event.data as SubscriptionNotification,
        );
        break;
      case EventName.SubscriptionUpdated:
        await this.onSubscriptionUpdated(
          event.data as SubscriptionNotification,
        );
        break;
      case EventName.SubscriptionCanceled:
        await this.onSubscriptionCanceled(
          event.data as SubscriptionNotification,
        );
        break;
      case EventName.TransactionCompleted:
      case EventName.TransactionPaid:
        await this.onTransactionPaid(event.data as TransactionNotification);
        break;
      case EventName.TransactionPaymentFailed:
        await this.onTransactionPaymentFailed(
          event.data as TransactionNotification,
          event.eventId,
        );
        break;
      default:
        this.logger.debug(`Unhandled Paddle event: ${event.eventType}`);
    }
  }

  /**
   * Record a Paddle event id exactly once. Returns true on first delivery, false
   * when the id already exists (a redelivery). The unique index on `event_id`
   * makes this an atomic dedup latch even across concurrent pods. Runs as SYSTEM
   * (this global provider-event table has no RLS).
   */
  private async recordPaddleEvent(
    eventId: string,
    eventType: string,
    paddleEntityId: string | null,
    occurredAt: Date | null,
  ): Promise<boolean> {
    try {
      await this.merchantContext.runAsSystem(() =>
        this.prisma.paddleWebhookEvent.create({
          data: { eventId, eventType, paddleEntityId, occurredAt },
        }),
      );
      return true;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return false;
      }
      throw error;
    }
  }

  /**
   * True when a strictly-newer event for the same Paddle entity has already been
   * recorded (excluding the event being processed). Used to drop stale,
   * out-of-order subscription deliveries before they mutate merchant state.
   */
  private async isSupersededByNewerEvent(
    paddleEntityId: string,
    occurredAt: Date,
    eventId: string,
  ): Promise<boolean> {
    const newer = await this.merchantContext.runAsSystem(() =>
      this.prisma.paddleWebhookEvent.findFirst({
        where: {
          paddleEntityId,
          occurredAt: { gt: occurredAt },
          eventId: { not: eventId },
        },
        select: { id: true },
      }),
    );
    return newer !== null;
  }

  private async onSubscriptionCreated(
    sub: SubscriptionNotification,
  ): Promise<void> {
    const merchantId = await this.merchantIdForEvent(
      sub.customData,
      sub.customerId,
    );
    if (!merchantId) return;
    const tier = this.tierFromCustomData(sub.customData);
    await this.merchantContext.runAsSystem(() =>
      this.prisma.merchant.update({
        where: { id: merchantId },
        data: {
          subscriptionPaddleId: sub.id,
          isActive: true,
          ...(tier ? { subscriptionTier: tier } : {}),
        },
      }),
    );
    if (tier) {
      await this.cacheTier(merchantId, tier);
    }
    await this.writeAudit(merchantId, "subscription_created", {
      subscriptionId: sub.id,
      tier,
    });
  }

  private async onSubscriptionUpdated(
    sub: SubscriptionNotification,
  ): Promise<void> {
    const merchantId = await this.merchantIdForEvent(
      sub.customData,
      sub.customerId,
    );
    if (!merchantId) return;
    const tier = this.tierFromCustomData(sub.customData);
    const active = sub.status === "active" || sub.status === "trialing";
    await this.merchantContext.runAsSystem(() =>
      this.prisma.merchant.update({
        where: { id: merchantId },
        data: { isActive: active, ...(tier ? { subscriptionTier: tier } : {}) },
      }),
    );
    if (tier) {
      await this.cacheTier(merchantId, tier);
    }
    await this.writeAudit(merchantId, "subscription_synced", {
      status: sub.status,
      tier,
    });
  }

  private async onSubscriptionCanceled(
    sub: SubscriptionNotification,
  ): Promise<void> {
    const merchantId = await this.merchantIdForEvent(
      sub.customData,
      sub.customerId,
    );
    if (!merchantId) return;
    await this.merchantContext.runAsSystem(() =>
      this.prisma.merchant.update({
        where: { id: merchantId },
        data: { isActive: false },
      }),
    );
    await this.writeAudit(merchantId, "subscription_deleted", {
      subscriptionId: sub.id,
    });
  }

  private async onTransactionPaid(txn: TransactionNotification): Promise<void> {
    const merchantId = await this.merchantIdForEvent(
      txn.customData,
      txn.customerId,
    );
    if (!merchantId) return;
    await this.merchantContext.runAsSystem(() =>
      this.prisma.merchant.update({
        where: { id: merchantId },
        data: { isActive: true },
      }),
    );
    await this.persistentRedis.del(`paddle:dunning:${merchantId}`);
    await this.writeAudit(merchantId, "billing_invoice_paid", {
      transactionId: txn.id,
    });
  }

  private async onTransactionPaymentFailed(
    txn: TransactionNotification,
    eventId: string,
  ): Promise<void> {
    const merchantId = await this.merchantIdForEvent(
      txn.customData,
      txn.customerId,
    );
    if (!merchantId) return;

    const key = `paddle:dunning:${merchantId}`;
    // Dunning counts DISTINCT failed-payment events, keyed by Paddle event id.
    // SADD is idempotent, so an at-least-once webhook redelivery (same eventId)
    // cannot inflate the count and wrongly suspend a paying merchant — while a
    // genuine new retry attempt (new eventId) still advances dunning. The old
    // INCR-per-delivery double-counted on every redelivery. The set lives on the
    // persistent (AOF, noeviction) Redis so LRU eviction can't drop it and reset
    // the 3-strike suspension (§6 MED).
    const added = await this.persistentRedis.sadd(key, eventId);
    const count = await this.persistentRedis.scard(key);
    if (added > 0 && count === 1) {
      await this.persistentRedis.expire(key, 30 * 24 * 60 * 60);
    }

    const merchant = await this.merchantContext.runAsSystem(() =>
      this.prisma.merchant.findUnique({
        where: { id: merchantId },
        select: {
          shopifyDomain: true,
          users: { where: { role: "owner" }, select: { email: true }, take: 1 },
        },
      }),
    );
    const ownerEmail = merchant?.users[0]?.email;
    const amount = txn.details?.totals?.grandTotal
      ? new Money(txn.details.totals.grandTotal).dividedBy(100).toFixed(2)
      : "0.00";
    const currency = (txn.currencyCode ?? "USD").toUpperCase();

    if (count >= DUNNING_SUSPEND_THRESHOLD) {
      await this.merchantContext.runAsSystem(() =>
        this.prisma.merchant.update({
          where: { id: merchantId },
          data: { isActive: false },
        }),
      );
      if (ownerEmail) {
        await this.email.sendMerchantPaymentFailureAlert({
          to: ownerEmail,
          merchantName: merchant?.shopifyDomain ?? "your account",
          reason: "Repeated subscription payment failures — account suspended",
          amount,
          currency,
        });
      }
      await this.writeAudit(merchantId, "billing_suspended", {
        failedCount: count,
      });
    } else if (ownerEmail) {
      await this.email.sendMerchantPaymentFailureAlert({
        to: ownerEmail,
        merchantName: merchant?.shopifyDomain ?? "your account",
        reason: "A subscription payment failed",
        amount,
        currency,
      });
      await this.writeAudit(merchantId, "billing_payment_failed", {
        failedCount: count,
      });
    }
  }

  // ── Usage summary + plan + portal ────────────────────────────────────────

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
        select: {
          subscriptionTier: true,
          gmvCurrentMonth: true,
          gmvMonthKey: true,
        },
      }),
    );
    const tier = merchant.subscriptionTier as SubscriptionTier;
    const monthKey = this.currentMonthKey();
    const gmv =
      merchant.gmvMonthKey === monthKey
        ? new Money(merchant.gmvCurrentMonth.toString())
        : new Money(0);
    const billable = Decimal.max(
      gmv.minus(GMV_FREE_THRESHOLD[tier]),
      new Money(0),
    );
    return {
      tier,
      gmvCurrentMonth: gmv.toFixed(2),
      freeThreshold: GMV_FREE_THRESHOLD[tier].toFixed(2),
      billableGmv: billable.toFixed(2),
      estimatedFee: billable
        .times(GMV_RATE[tier])
        .toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN)
        .toFixed(2),
    };
  }

  /**
   * Current plan snapshot for the billing page. Status is derived from the
   * merchant row (there is no `subscriptionStatus` column): an unsubscribed
   * merchant inside its trial window is `trial`; otherwise `active`/`inactive`
   * follows `isActive` (the dunning flow flips it). The next billing date comes
   * from Paddle when a subscription exists, else falls back to the trial end.
   */
  async getPlan(merchantId: string): Promise<BillingPlan> {
    const merchant = await this.merchantContext.runAsSystem(() =>
      this.prisma.merchant.findUniqueOrThrow({
        where: { id: merchantId },
        select: {
          subscriptionTier: true,
          subscriptionPaddleId: true,
          isActive: true,
          trialEndsAt: true,
        },
      }),
    );
    const tier = merchant.subscriptionTier as SubscriptionTier;
    const trialActive =
      !merchant.subscriptionPaddleId &&
      merchant.trialEndsAt !== null &&
      merchant.trialEndsAt.getTime() > Date.now();
    const status: BillingPlan["status"] = trialActive
      ? "trial"
      : merchant.isActive
        ? "active"
        : "inactive";

    let nextBillingDate: string | null = merchant.trialEndsAt
      ? merchant.trialEndsAt.toISOString()
      : null;
    if (merchant.subscriptionPaddleId) {
      try {
        const subscription = await this.fire(() =>
          this.paddle.subscriptions.get(
            merchant.subscriptionPaddleId as string,
          ),
        );
        if (subscription.nextBilledAt) {
          nextBillingDate = new Date(subscription.nextBilledAt).toISOString();
        }
      } catch (error) {
        this.logger.warn(
          `Could not read Paddle next-billed date for ${merchantId}: ${(error as Error).message}`,
        );
      }
    }

    return {
      tier,
      status,
      isTrial: trialActive,
      amount: TIER_FLAT_PRICE[tier],
      priceLabel: `$${new Money(TIER_FLAT_PRICE[tier]).toFixed(2)}/mo`,
      nextBillingDate,
      trialEndsAt: merchant.trialEndsAt
        ? merchant.trialEndsAt.toISOString()
        : null,
    };
  }

  /** A Paddle customer-portal session URL for self-serve plan/payment management. */
  async createBillingPortalSession(merchantId: string): Promise<string> {
    const merchant = await this.merchantContext.runAsSystem(() =>
      this.prisma.merchant.findUniqueOrThrow({
        where: { id: merchantId },
        select: { subscriptionPaddleId: true },
      }),
    );
    const customer = await this.createOrRetrieveCustomer(merchantId);
    const subscriptionIds = merchant.subscriptionPaddleId
      ? [merchant.subscriptionPaddleId]
      : [];
    const session = await this.fire(() =>
      this.paddle.customerPortalSessions.create(customer.id, subscriptionIds),
    );
    return session.urls.general.overview;
  }

  /** Verify + construct a Paddle event from the raw webhook body + signature. */
  async constructEvent(
    rawBody: Buffer,
    signature: string,
  ): Promise<EventEntity> {
    return this.paddle.webhooks.unmarshal(
      rawBody.toString("utf8"),
      this.config.get("PADDLE_WEBHOOK_SECRET"),
      signature,
    );
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private flatPriceId(tier: SubscriptionTier): string {
    switch (tier) {
      case "starter":
        return this.config.get("PADDLE_STARTER_PRICE_ID");
      case "growth":
        return this.config.get("PADDLE_GROWTH_PRICE_ID");
      case "pro":
        return this.config.get("PADDLE_PRO_PRICE_ID");
    }
  }

  private tierFromCustomData(customData: unknown): SubscriptionTier | null {
    const tier = (customData as { subscriptionTier?: unknown } | null)
      ?.subscriptionTier;
    return tier === "starter" || tier === "growth" || tier === "pro"
      ? tier
      : null;
  }

  /**
   * Resolve the merchant for a webhook: prefer the `merchantId` we stamped into
   * Paddle `customData`, falling back to a lookup on the Paddle customer id.
   */
  private async merchantIdForEvent(
    customData: unknown,
    customerId: string | null,
  ): Promise<string | null> {
    const stamped = (customData as { merchantId?: unknown } | null)?.merchantId;
    if (typeof stamped === "string" && stamped.length > 0) {
      return stamped;
    }
    if (!customerId) {
      this.logger.warn(
        "Paddle event has neither customData.merchantId nor a customerId",
      );
      return null;
    }
    const merchant = await this.merchantContext.runAsSystem(() =>
      this.prisma.merchant.findUnique({
        where: { paddleCustomerId: customerId },
        select: { id: true },
      }),
    );
    if (!merchant) {
      this.logger.warn(`No merchant for Paddle customer ${customerId}`);
      return null;
    }
    return merchant.id;
  }

  private async cacheTier(
    merchantId: string,
    tier: SubscriptionTier,
  ): Promise<void> {
    await this.cache.set(`merchant:tier:${merchantId}`, tier);
  }

  private currentMonthKey(): string {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  /** The `YYYY-MM` key for the month that just closed (relative to now, UTC). */
  private previousMonthKey(): string {
    const now = new Date();
    const prev = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
    );
    return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  private async writeAudit(
    merchantId: string,
    action: string,
    newValueJson: Record<string, unknown>,
    actor: {
      actorType: "merchant_user" | "paddle_webhook" | "system";
      actorId?: string;
    } = {
      actorType: "paddle_webhook",
    },
  ): Promise<void> {
    try {
      await this.merchantContext.runAsSystem(() =>
        this.prisma.auditLog.create({
          data: {
            merchantId,
            entityType: "merchant",
            entityId: merchantId,
            action,
            actorType: actor.actorType,
            ...(actor.actorId ? { actorId: actor.actorId } : {}),
            newValueJson: newValueJson as Prisma.InputJsonValue,
          },
        }),
      );
    } catch (error) {
      // CLAUDE.md mandates an audit row for every financial state change. We do
      // not fail the caller (a webhook/cron should not 500 purely because the
      // audit insert failed and then get redelivered), but a missing financial
      // audit row must never pass silently — capture it for reconciliation.
      Sentry.captureException(error, {
        level: "error",
        tags: { component: "billing", audit_action: action },
        extra: { merchantId },
      });
      this.logger.error(
        `Failed to write billing audit log (${action}) for ${merchantId}: ${(error as Error).message}`,
      );
    }
  }

  /** Run a Paddle action through the shared breaker with correct typing. */
  private async fire<T>(action: PaddleAction<T>): Promise<T> {
    return this.breaker.fire(action as PaddleAction<unknown>) as Promise<T>;
  }
}
