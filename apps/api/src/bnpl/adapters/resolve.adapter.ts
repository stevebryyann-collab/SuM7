import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type CircuitBreaker from 'opossum';
import { Decimal } from 'decimal.js';
import { AppConfigService } from '../../config/app-config.service';
import { CircuitBreakerFactory } from '../../common/circuit-breaker/circuit-breaker.factory';
import { PrismaService } from '../../prisma/prisma.service';
import { MerchantContextService } from '../../prisma/merchant-context.service';
import { InvoicesService } from '../../invoices/invoices.service';
import { EmailService } from '../../email/email.service';
import type {
  BnplAdapter,
  BnplWebhookEvent,
  EligibilityParams,
  EligibilityResult,
  FinancingParams,
  FinancingResult,
} from '../bnpl.interfaces';

const Money = Decimal.clone({ rounding: Decimal.ROUND_HALF_EVEN, precision: 40 });
const MAX_RETRIES = 3;

/** An HTTP request the breaker action performs (exactly one round-trip). */
interface ResolveRequest {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  idempotencyKey?: string;
}

/** Raw response the breaker action returns; non-2xx is surfaced, not thrown for 4xx. */
interface ResolveResponse {
  status: number;
  body: unknown;
}

/** Transient error so the breaker counts 5xx/network failures toward its rate. */
class ResolveTransientError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ResolveTransientError';
  }
}

/** Shape of the Resolve eligibility response we map FROM (kept private). */
interface ResolveChargeResponse {
  approved?: boolean;
  amount_authorized?: string | number;
  terms?: number[];
  decline_message?: string;
  id?: string;
  hosted_url?: string;
  expires_at?: string;
}

/**
 * Resolve BNPL adapter. Every HTTP call goes through the shared `resolve`
 * circuit breaker (10s timeout). 5xx/network failures are retried up to 3× with
 * exponential backoff and count toward the breaker; 4xx responses are returned
 * to the caller and never retried. Resolve's field names are mapped to the
 * provider-agnostic {@link EligibilityResult}/{@link FinancingResult} so callers
 * never see Resolve-specific shapes.
 */
@Injectable()
export class ResolveAdapter implements BnplAdapter, OnModuleInit {
  readonly providerName = 'resolve';
  private readonly logger = new Logger(ResolveAdapter.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly webhookSecret: string;
  private breaker!: CircuitBreaker<[ResolveRequest], ResolveResponse>;

  constructor(
    private readonly config: AppConfigService,
    private readonly breakerFactory: CircuitBreakerFactory,
    private readonly prisma: PrismaService,
    private readonly merchantContext: MerchantContextService,
    private readonly invoices: InvoicesService,
    private readonly email: EmailService,
  ) {
    this.baseUrl = this.config.get('RESOLVE_API_BASE_URL').replace(/\/+$/, '');
    this.apiKey = this.config.get('RESOLVE_API_KEY');
    this.webhookSecret = this.config.get('RESOLVE_WEBHOOK_SECRET');
  }

  onModuleInit(): void {
    this.breaker = this.breakerFactory.create<[ResolveRequest], ResolveResponse>(
      'resolve',
      (req: ResolveRequest) => this.performRequest(req),
      { timeout: 10_000 },
    );
  }

  // ── Eligibility ────────────────────────────────────────────────────────

  async checkEligibility(params: EligibilityParams): Promise<EligibilityResult> {
    const response = await this.fireWithRetry({
      method: 'POST',
      path: '/charges/eligibility',
      body: {
        amount: params.orderAmount.toFixed(2),
        currency: params.currency,
        customer: {
          business_name: params.buyer.companyName,
          email: params.buyer.email,
        },
      },
    });

    if (response.status >= 400) {
      // A 4xx eligibility check means "not eligible", not an outage.
      return {
        eligible: false,
        approvedAmount: null,
        availableTermsDays: [],
        currency: params.currency,
        declineReason: 'Financing is not available for this order',
      };
    }

    const data = response.body as ResolveChargeResponse;
    const approved = data.approved === true;
    return {
      eligible: approved,
      approvedAmount:
        approved && data.amount_authorized != null
          ? new Money(data.amount_authorized.toString())
          : null,
      availableTermsDays: Array.isArray(data.terms) ? data.terms : [],
      currency: params.currency,
      declineReason: approved ? null : 'Financing is not available for this order',
    };
  }

  // ── Financing ──────────────────────────────────────────────────────────

  async initiateFinancing(params: FinancingParams): Promise<FinancingResult> {
    const response = await this.fireWithRetry({
      method: 'POST',
      path: '/charges',
      idempotencyKey: params.idempotencyKey,
      body: {
        amount: params.amount.toFixed(2),
        currency: params.currency,
        term_days: params.selectedTermDays,
        // Our invoice id is the provider reference — webhooks map back via this.
        reference: params.invoiceId,
        metadata: { order_id: params.orderId },
      },
    });

    if (response.status >= 400) {
      throw new ResolveTransientError(
        `Resolve financing initiation rejected (${response.status})`,
        response.status,
      );
    }

    const data = response.body as ResolveChargeResponse;
    if (!data.id || !data.hosted_url || !data.expires_at) {
      throw new Error('Resolve response missing required financing fields');
    }
    return {
      referenceId: data.id,
      redirectUrl: data.hosted_url,
      expiresAt: data.expires_at,
    };
  }

  // ── Webhooks ─────────────────────────────────────────────────────────────

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const expected = createHmac('sha256', this.webhookSecret).update(rawBody, 'utf8').digest('hex');
    const expectedBuf = Buffer.from(expected, 'utf8');
    const providedBuf = Buffer.from(signature, 'utf8');
    if (expectedBuf.length !== providedBuf.length) {
      return false;
    }
    return timingSafeEqual(expectedBuf, providedBuf);
  }

  async handleWebhook(
    rawBody: string,
    signature: string,
    event: BnplWebhookEvent,
  ): Promise<void> {
    if (!this.verifyWebhookSignature(rawBody, signature)) {
      throw new Error('Resolve webhook signature verification failed');
    }
    if (!event.invoiceId) {
      this.logger.warn('Resolve webhook has no invoice reference; ignoring');
      return;
    }

    switch (event.type) {
      case 'PAYMENT_CONFIRMED':
        await this.onPaymentConfirmed(event.invoiceId);
        break;
      case 'PAYMENT_DEFAULTED':
        await this.onPaymentDefaulted(event.invoiceId);
        break;
      default:
        this.logger.debug(`Unhandled Resolve webhook type for invoice ${event.invoiceId}`);
    }
  }

  /** Mark the invoice fully paid via InvoicesService (the financial system of record). */
  private async onPaymentConfirmed(invoiceId: string): Promise<void> {
    const invoice = await this.merchantContext.runAsSystem(() =>
      this.prisma.invoice.findUnique({
        where: { id: invoiceId },
        select: {
          merchantId: true,
          total: true,
          status: true,
          merchant: {
            select: { users: { where: { role: 'owner' }, select: { id: true }, take: 1 } },
          },
        },
      }),
    );
    if (!invoice) {
      this.logger.warn(`Resolve PAYMENT_CONFIRMED for unknown invoice ${invoiceId}`);
      return;
    }
    if (invoice.status === 'paid' || invoice.status === 'void') {
      this.logger.log(`Invoice ${invoiceId} already ${invoice.status}; skipping Resolve confirm`);
      return;
    }
    const actorId = invoice.merchant.users[0]?.id;
    if (!actorId) {
      this.logger.error(`Invoice ${invoiceId} merchant has no owner user; cannot record payment`);
      return;
    }

    await this.invoices.markAsPaid(
      invoiceId,
      invoice.merchantId,
      { amountPaid: invoice.total.toFixed(2), reference: 'resolve-bnpl' },
      actorId,
    );
  }

  /** Flag the invoice as defaulted and alert the merchant. */
  private async onPaymentDefaulted(invoiceId: string): Promise<void> {
    const invoice = await this.merchantContext.runAsSystem(() =>
      this.prisma.invoice.findUnique({
        where: { id: invoiceId },
        select: {
          merchantId: true,
          total: true,
          currency: true,
          status: true,
          merchant: { select: { shopifyDomain: true, users: { where: { role: 'owner' }, select: { id: true, email: true }, take: 1 } } },
        },
      }),
    );
    if (!invoice) {
      this.logger.warn(`Resolve PAYMENT_DEFAULTED for unknown invoice ${invoiceId}`);
      return;
    }

    await this.merchantContext.run(invoice.merchantId, () =>
      this.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.current_merchant_id = '${invoice.merchantId}'`);
        await tx.invoice.update({ where: { id: invoiceId }, data: { status: 'defaulted' } });
        await tx.auditLog.create({
          data: {
            merchantId: invoice.merchantId,
            entityType: 'invoice',
            entityId: invoiceId,
            action: 'bnpl_defaulted',
            actorType: 'bnpl_webhook',
            newValueJson: { status: 'defaulted' },
          },
        });
      }),
    );

    const owner = invoice.merchant.users[0];
    if (owner) {
      await this.email.sendMerchantPaymentFailureAlert({
        to: owner.email,
        merchantName: invoice.merchant.shopifyDomain,
        reason: 'BNPL financing defaulted',
        amount: invoice.total.toFixed(2),
        currency: invoice.currency,
      });
    }
  }

  // ── HTTP plumbing (breaker + retry) ───────────────────────────────────────

  /** Fire through the breaker, retrying transient (5xx/network) failures. */
  private async fireWithRetry(req: ResolveRequest): Promise<ResolveResponse> {
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      try {
        return await this.breaker.fire(req);
      } catch (error) {
        lastError = error;
        // Only transient errors are retryable; 4xx never throws from the action.
        if (error instanceof ResolveTransientError && attempt < MAX_RETRIES - 1) {
          await this.sleep(2 ** attempt * 200);
          continue;
        }
        throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Resolve request failed');
  }

  /** The breaker action: exactly one network round-trip. Throws on 5xx/network. */
  private async performRequest(req: ResolveRequest): Promise<ResolveResponse> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
    };
    if (req.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (req.idempotencyKey) {
      headers['Idempotency-Key'] = req.idempotencyKey;
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${req.path}`, {
        method: req.method,
        headers,
        ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
      });
    } catch (networkError) {
      throw new ResolveTransientError(
        `Resolve network error: ${(networkError as Error).message}`,
        0,
      );
    }

    if (response.status >= 500) {
      // 5xx → throw so the breaker + retry loop treat it as transient.
      throw new ResolveTransientError(`Resolve server error ${response.status}`, response.status);
    }

    const text = await response.text();
    let body: unknown = null;
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: text };
      }
    }
    return { status: response.status, body };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
