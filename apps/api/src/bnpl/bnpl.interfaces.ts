import type { Decimal } from 'decimal.js';

/**
 * Provider-agnostic BNPL contract. ALL business logic talks to a
 * {@link BnplAdapter}; the Resolve SDK/field names never leak past the adapter
 * boundary (a CLAUDE.md non-negotiable). Monetary values are Decimal end-to-end.
 */

/** A buyer's financial profile, normalized for an eligibility check. */
export interface BuyerProfileForBnpl {
  buyerId: string;
  merchantId: string;
  companyName: string;
  email: string;
  /** Encrypted tax id string as stored (never decrypted here). */
  taxId: string | null;
  /** The buyer's currently-approved credit limit, if any. */
  creditLimit: Decimal | null;
  /** Credit already consumed against the relationship. */
  creditUsed: Decimal;
}

/** Inputs to an eligibility check. */
export interface EligibilityParams {
  buyer: BuyerProfileForBnpl;
  orderAmount: Decimal;
  currency: string;
}

/** Normalized eligibility result — no provider-specific fields. */
export interface EligibilityResult {
  eligible: boolean;
  /** Maximum financeable amount, or null when not eligible. */
  approvedAmount: Decimal | null;
  /** Offered payment-term options, in days (e.g. [30, 60, 90]). */
  availableTermsDays: number[];
  currency: string;
  /** A safe, buyer-facing reason when not eligible (never raw provider text). */
  declineReason: string | null;
}

/** Inputs to initiate a financing session. */
export interface FinancingParams {
  buyer: BuyerProfileForBnpl;
  /** Our invoice id — used as the provider reference so webhooks can be mapped back. */
  invoiceId: string;
  orderId: string;
  amount: Decimal;
  currency: string;
  /** Selected term in days (must be one of the eligibility offer). */
  selectedTermDays: number;
  /** Idempotency token forwarded to the provider's create call. */
  idempotencyKey: string;
}

/** Normalized financing-initiation result. */
export interface FinancingResult {
  /** Opaque provider reference for the financing record. */
  referenceId: string;
  /** Hosted URL the buyer is redirected to in order to complete financing. */
  redirectUrl: string;
  /** ISO timestamp after which the redirect link is no longer valid. */
  expiresAt: string;
}

/** Normalized webhook event the adapter decodes from the provider payload. */
export type BnplWebhookEventType = 'PAYMENT_CONFIRMED' | 'PAYMENT_DEFAULTED' | 'UNKNOWN';

export interface BnplWebhookEvent {
  type: BnplWebhookEventType;
  /** The provider reference we mapped to our invoice id at initiation time. */
  invoiceId: string | null;
  referenceId: string | null;
}

/**
 * The interface every BNPL provider integration implements. Region/merchant
 * routing happens in {@link import('./bnpl.service').BnplService}; adapters are
 * stateless aside from their HTTP client + circuit breaker.
 */
export interface BnplAdapter {
  readonly providerName: string;
  checkEligibility(params: EligibilityParams): Promise<EligibilityResult>;
  initiateFinancing(params: FinancingParams): Promise<FinancingResult>;
  verifyWebhookSignature(rawBody: string, signature: string): boolean;
  handleWebhook(rawBody: string, signature: string, event: BnplWebhookEvent): Promise<void>;
}
