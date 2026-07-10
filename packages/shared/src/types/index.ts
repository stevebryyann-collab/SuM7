/**
 * Shared domain types — consumed by both apps/web and apps/api.
 * These mirror the Prisma enums but are framework-agnostic so the frontend
 * never imports the Prisma client.
 */

// ── Enumerations (kept in sync with prisma/schema.prisma) ──────────────

export type PricingTierType = 'percentage_off' | 'fixed_price_list' | 'volume_breaks';

export type PaymentTerms = 'immediate' | 'net15' | 'net30' | 'net60' | 'net90';

export type InvoiceStatus =
  | 'draft'
  | 'sent'
  | 'viewed'
  | 'partially_paid'
  | 'paid'
  | 'overdue'
  | 'void'
  | 'defaulted';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

export type MerchantRole = 'owner' | 'admin' | 'staff' | 'sales_rep';

export type SubscriptionTier = 'starter' | 'growth' | 'pro';

// ── Auth / session payloads ────────────────────────────────────────────

/**
 * Decoded NextAuth session for a merchant user, surfaced to the API via the
 * merchant-session guard.
 */
export interface MerchantSession {
  merchantId: string;
  merchantUserId: string;
  shopifyDomain: string;
  role: MerchantRole;
  email: string;
}

/**
 * RS256 buyer access-token claims. `aud`/`iss` are validated on every request;
 * `jti` is the per-token id used for Redis-backed revocation.
 */
export interface BuyerTokenPayload {
  sub: string; // buyerId
  merchantId: string;
  pricingTierId: string | null;
  jti: string;
  aud: 'b2b-wholesale-buyer';
  iss: 'b2b-wholesale-api';
  iat: number;
  exp: number;
}

// ── Pricing engine value objects ───────────────────────────────────────

/**
 * One bracket of a `volume_breaks` pricing tier. Brackets must be
 * non-overlapping with strictly ascending `minQty` (validated in Zod).
 */
export interface VolumeBreakCondition {
  minQty: number;
  /** Discount percentage applied at or above `minQty` (0–100). */
  discountPct: number;
}

/**
 * A single Shopify variant after a pricing tier has been resolved against it.
 */
export interface PricedVariant {
  shopifyProductId: string;
  shopifyVariantId: string;
  sku: string | null;
  basePrice: string; // Decimal serialized as string to avoid float drift
  resolvedPrice: string;
  appliedTierType: PricingTierType | null;
  discountPct: string | null;
  currency: string;
}

/**
 * A fully-resolved order line ready to be persisted / pushed to Shopify.
 */
export interface ResolvedOrderLine {
  shopifyProductId: string;
  shopifyVariantId: string;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  appliedTierType: PricingTierType | null;
  discountPct: string | null;
  currency: string;
}

// ── API envelope types ─────────────────────────────────────────────────

export interface ApiFieldError {
  field: string;
  message: string;
  code: string;
}

export interface ApiError {
  statusCode: number;
  code: string;
  message: string;
  errors?: ApiFieldError[];
  correlationId?: string;
}

/**
 * Cursor-based pagination envelope. The cursor is an opaque base64 string;
 * callers must treat it as a black box and never parse it.
 */
export interface PaginatedResponse<T> {
  data: T[];
  pageInfo: {
    hasNextPage: boolean;
    /** Opaque base64 cursor for the next page, or null when exhausted. */
    endCursor: string | null;
  };
}

/**
 * Decoded representation of an opaque pagination cursor. Not exported across
 * the API boundary — only used internally by cursor encode/decode helpers.
 */
export interface DecodedCursor {
  /** ISO timestamp of the last row's sort key. */
  createdAt: string;
  /** Tiebreaker id of the last row. */
  id: string;
}

// ── Buyer portal (white-label) ─────────────────────────────────────────

/**
 * Derive a human-readable merchant display name from a Shopify domain. Strips
 * the `.myshopify.com` suffix and title-cases the handle (`acme-apparel` →
 * `Acme Apparel`). Used for the white-label buyer portal headings/emails where
 * no dedicated store-name column exists. Pure + framework-agnostic so the web
 * edge, web server components, and the API all produce identical output.
 */
export function merchantDisplayNameFromDomain(domain: string | null | undefined): string {
  const raw = (domain ?? '').trim().toLowerCase();
  if (!raw) return 'Wholesale';
  const handle = raw.replace(/\.myshopify\.com$/, '').split('.')[0] ?? raw;
  const words = handle
    .split(/[-_]+/)
    .filter((w) => w.length > 0)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return words.length > 0 ? words.join(' ') : 'Wholesale';
}

/** White-label merchant branding returned by `GET /buyer/merchant-context`. */
export interface MerchantContextDto {
  merchantId: string;
  shopDomain: string;
  displayName: string;
  contactEmail: string;
}

/** The buyer's per-merchant application state, from `GET /buyer/application-status`. */
export interface ApplicationStatusDto {
  status: 'none' | 'pending' | 'approved' | 'rejected' | 'suspended';
  companyName: string | null;
  appliedAt: string | null;
  reviewedAt: string | null;
  merchantDisplayName: string;
  contactEmail: string;
}
