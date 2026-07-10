import type {
  ApprovalStatus,
  InvoiceStatus,
  MerchantRole,
  PaginatedResponse,
  PaymentTerms,
  PricingTierType,
  SubscriptionTier,
} from '@b2b/shared/types';

/**
 * Frontend mirrors of the API's response DTOs. These are NOT re-exported from
 * `@b2b/shared` because they are server response shapes (service return types),
 * not shared request schemas. Kept in lockstep with the controllers in apps/api.
 */

// ── Merchant dashboard (GraphQL) ────────────────────────────────────────

export interface MerchantDashboard {
  gmvCurrentMonth: string;
  gmvPreviousMonth: string;
  /** Lifetime paid GMV across all months (drives the GMV milestone toasts). */
  allTimeGmv: string;
  gmvChangePercent: string | null;
  outstandingArBalance: string;
  overdueInvoiceCount: number;
  overdueInvoiceAmount: string;
  newBuyersThisMonth: number;
  pendingApplicationCount: number;
}

export interface ArAgingBucket {
  bucket: string;
  invoiceCount: number;
  outstandingAmount: string;
}

export interface ArAgingReport {
  current: ArAgingBucket;
  overdue_1_30: ArAgingBucket;
  overdue_31_60: ArAgingBucket;
  overdue_61_90: ArAgingBucket;
  overdue_90_plus: ArAgingBucket;
}

/** One point of the 30-day GMV trend (derived client-side from paid invoices). */
export interface GmvTrendPoint {
  date: string;
  gmv: string;
}

// ── Buyers (merchant admin list + approval) ─────────────────────────────

export interface BuyerSummary {
  buyerId: string;
  companyName: string;
  email: string;
  approvalStatus: ApprovalStatus | string;
  pricingTierName: string | null;
  paymentTerms: PaymentTerms;
  creditLimit: string | null;
  orderCount: number;
  outstandingInvoiceTotal: string;
  lastOrderAt: string | null;
  createdAt: string;
}

/**
 * A pending registration application surfaced in the approval panel.
 *
 * PII (taxId, phone) is NOT part of this payload — it is fetched on demand via
 * the audited reveal endpoint ({@link ApplicationPii}). `hasTaxId` / `hasPhone`
 * indicate whether a reveal would return a value.
 */
export interface BuyerApplication {
  id: string;
  email: string;
  companyName: string;
  businessType: string | null;
  website: string | null;
  estimatedMonthlyOrder: string | null;
  message: string | null;
  hasTaxId: boolean;
  hasPhone: boolean;
  status: ApprovalStatus | string;
  createdAt: string;
}

/** Decrypted/plaintext application PII, returned only by the audited reveal endpoint. */
export interface ApplicationPii {
  taxId: string | null;
  phone: string | null;
}

/**
 * Full per-buyer detail (merchant View panel + approved-buyer inline edit).
 * Carries the relationship config plus the same aggregates as {@link BuyerSummary}.
 */
export interface BuyerDetail {
  buyerId: string;
  companyName: string;
  email: string;
  businessType: string | null;
  approvalStatus: ApprovalStatus | string;
  pricingTierId: string | null;
  pricingTierName: string | null;
  paymentTerms: PaymentTerms;
  creditLimit: string | null;
  notes: string | null;
  orderCount: number;
  outstandingInvoiceTotal: string;
  lastOrderAt: string | null;
  approvedAt: string | null;
  createdAt: string;
}

// ── Pricing tiers ───────────────────────────────────────────────────────

export interface PricingTierSummary {
  id: string;
  name: string;
  type: PricingTierType | string;
  baseDiscountPct: string | null;
  isDefault: boolean;
  minOrderAmount: string | null;
  priority: number;
  isActive: boolean;
  buyerCount: number;
  /** Only meaningful for `volume_breaks` tiers. */
  conditionsJson: PricingTierConditions | null;
  /** Only meaningful for `fixed_price_list` tiers. */
  overrideCount: number;
  createdAt: string;
}

/** A volume-break bracket (qty threshold → discount %). Stored in conditionsJson. */
export interface VolumeBreakBracket {
  minQty: number;
  discountPct: number;
}

/** Tier `conditionsJson` shape (only meaningful for `volume_breaks` tiers). */
export interface PricingTierConditions {
  brackets: VolumeBreakBracket[];
}

/** A per-variant price override row in the tier-detail list. */
export interface PricingOverrideSummary {
  id: string;
  shopifyProductId: string;
  shopifyVariantId: string | null;
  price: string;
  compareAtPrice: string | null;
  currency: string;
  createdAt: string;
}

/** Tier detail = summary header + conditions + first page of overrides. `conditionsJson` is inherited from the summary. */
export interface PricingTierDetail extends PricingTierSummary {
  overrides: PaginatedResponse<PricingOverrideSummary>;
}

// ── Orders ──────────────────────────────────────────────────────────────

export interface OrderSummary {
  id: string;
  shopifyOrderNumber: string | null;
  buyerCompanyName: string | null;
  status: string;
  syncStatus: string;
  itemCount: number;
  subtotal: string;
  total: string;
  currency: string;
  paymentTerms: PaymentTerms | null;
  dueDate: string | null;
  createdAt: string;
  invoiceStatus: string | null;
  invoiceDueDate: string | null;
}

export interface OrderLineDetail {
  shopifyVariantId: string | null;
  shopifyProductId: string | null;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  appliedTierType: string | null;
  discountPct: string | null;
  currency: string;
}

export interface OrderDetail {
  id: string;
  shopifyOrderId: string | null;
  shopifyOrderNumber: string | null;
  buyerId: string;
  buyerCompanyName: string | null;
  status: string;
  syncStatus: string;
  subtotal: string;
  taxAmount: string;
  shippingAmount: string;
  total: string;
  currency: string;
  paymentTerms: PaymentTerms | null;
  dueDate: string | null;
  notes: string | null;
  createdAt: string;
  /** Part 2/3: back-order flag + Shopify fulfillment tracking (buyer order detail). */
  containsBackOrder: boolean;
  trackingNumber: string | null;
  trackingUrl: string | null;
  fulfillmentService: string | null;
  shippedAt: string | null;
  estimatedDeliveryAt: string | null;
  lineItems: OrderLineDetail[];
  invoice: {
    id: string;
    invoiceNumber: string;
    status: string;
    dueDate: string;
    total: string;
    amountPaid: string;
  } | null;
}

export interface OrderCreatedResult {
  orderId: string;
  shopifyOrderNumber: string;
  subtotal: string;
  total: string;
  currency: string;
  paymentTerms: PaymentTerms;
  dueDate: string | null;
  estimatedInvoiceDelivery: string;
}

// ── Invoices ────────────────────────────────────────────────────────────

export interface InvoiceSummary {
  id: string;
  invoiceNumber: string;
  buyerCompanyName: string | null;
  status: InvoiceStatus | string;
  total: string;
  amountPaid: string;
  dueDate: string;
  issuedAt: string | null;
  lastReminderAt: string | null;
  reminderCount: number;
  createdAt: string;
}

/** One line item rendered on the invoice detail / preview. */
export interface InvoiceLineDetail {
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
}

/** One recorded payment against an invoice (derived from the audit trail). */
export interface InvoicePayment {
  amount: string;
  paidAt: string;
  reference: string | null;
  recordedBy: string | null;
}

/** One audit-trail entry on the invoice detail view. */
export interface InvoiceAuditEntry {
  id: string;
  action: string;
  actorType: string;
  actorLabel: string | null;
  createdAt: string;
}

/** Full invoice detail (`GET /invoices/:id`). */
export interface InvoiceDetail {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus | string;
  orderId: string | null;
  shopifyOrderNumber: string | null;
  buyerId: string;
  buyerCompanyName: string | null;
  buyerEmail: string | null;
  buyerAddressLines: string[];
  merchantName: string;
  invoiceDate: string;
  dueDate: string;
  paymentTerms: PaymentTerms | null;
  subtotal: string;
  taxAmount: string;
  total: string;
  amountPaid: string;
  outstanding: string;
  currency: string;
  sentAt: string | null;
  firstViewedAt: string | null;
  paidAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  reminderCount: number;
  lastReminderAt: string | null;
  createdAt: string;
  lineItems: InvoiceLineDetail[];
  payments: InvoicePayment[];
  auditTrail: InvoiceAuditEntry[];
}

// ── Catalog (buyer portal) ──────────────────────────────────────────────

export interface CatalogVariant {
  shopifyVariantId: string;
  sku: string | null;
  color: string | null;
  size: string | null;
  basePrice: string;
  resolvedPrice: string;
  appliedTierType: PricingTierType | null;
  /** Discount % on a `percentage_off` tier (drives the "X% off" badge); else null. */
  discountPct: string | null;
  /** Bracket ladder on a `volume_breaks` tier (drives the live volume popover); else null. */
  volumeBrackets: VolumeBreakBracket[] | null;
  available: boolean;
}

export interface CatalogProduct {
  shopifyProductId: string;
  title: string;
  handle: string;
  vendor: string;
  productType: string;
  colors: string[];
  sizes: string[];
  variants: CatalogVariant[];
}

export interface CatalogPage {
  products: CatalogProduct[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  stale: boolean;
}

// ── Buyer account / BNPL (buyer portal) ─────────────────────────────────

/** The approved buyer's own relationship snapshot (`GET /buyer/me`). */
export interface BuyerMe {
  companyName: string;
  pricingTierName: string | null;
  /** The buyer's tier minimum order amount (decimal string), or null when none. */
  minOrderAmount: string | null;
  paymentTerms: PaymentTerms;
  /** Credit limit, or null for an uncapped relationship. Money as a decimal string. */
  creditLimit: string | null;
  creditUsed: string;
  /** max(limit - used, 0), or null when there is no limit. */
  creditAvailable: string | null;
  memberSince: string | null;
  /** True when the merchant's plan (growth/pro) enables BNPL financing. */
  bnplEnabled: boolean;
}

/** Resolve eligibility result (`POST /api/v1/buyer/bnpl/eligibility`). */
export interface BnplEligibility {
  eligible: boolean;
  /** Maximum financeable amount as a decimal string, or null when not eligible. */
  approvedAmount: string | null;
  /** Offered term lengths in days (e.g. [60, 90]). */
  availableTermsDays: number[];
  currency: string;
  declineReason: string | null;
}

// ── Dashboard aggregator (REST GET /api/v1/dashboard) ───────────────────

export interface DashboardKpis {
  gmvCurrentMonth: string;
  gmvPreviousMonth: string;
  gmvChangePercent: string | null;
  outstandingArBalance: string;
  outstandingInvoiceCount: number;
  overdueInvoiceCount: number;
  overdueInvoiceAmount: string;
  newBuyersThisMonth: number;
  pendingApplicationCount: number;
}

export interface DashboardTrendPoint {
  date: string;
  gmv: string;
}

export interface DashboardPendingApp {
  id: string;
  companyName: string;
  businessType: string | null;
  createdAt: string;
}

export interface DashboardSetup {
  hasTier: boolean;
  hasApprovedBuyer: boolean;
  hasSubscription: boolean;
}

export interface DashboardData {
  kpis: DashboardKpis;
  aging: ArAgingReport;
  gmvTrend: DashboardTrendPoint[];
  recentInvoices: InvoiceSummary[];
  pendingApplications: DashboardPendingApp[];
  setup: DashboardSetup;
}

// ── Analytics (REST GET /api/v1/analytics) ──────────────────────────────

export interface AnalyticsKpis {
  gmv: string;
  orders: number;
  avgOrderValue: string;
  activeBuyers: number;
}

export interface AnalyticsTrendPoint {
  date: string;
  gmv: string;
  orderCount: number;
}

export interface AnalyticsTopBuyer {
  buyerId: string;
  companyName: string;
  gmv: string;
  orderCount: number;
  avgOrderValue: string;
}

export interface AnalyticsMonthlyRow {
  month: string;
  gmv: string;
  orders: number;
  avgOrder: string;
  yoyChangePct: string | null;
}

export interface AnalyticsData {
  range: { from: string; to: string };
  kpis: AnalyticsKpis;
  trend: AnalyticsTrendPoint[];
  topBuyers: AnalyticsTopBuyer[];
  monthly: AnalyticsMonthlyRow[];
}

// ── Settings (REST /api/v1/settings) ────────────────────────────────────

export interface NotificationPrefs {
  newApplication: boolean;
  invoiceOverdue: boolean;
  paymentReceived: boolean;
}

export interface MerchantSettings {
  storeName: string;
  shopifyDomain: string;
  platformDomain: string;
  applicationLink: string;
  invoicePrefix: string;
  paymentInstructions: string | null;
  notifications: NotificationPrefs;
}

// ── Team (REST /api/v1/team) ────────────────────────────────────────────

export interface TeamMember {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: MerchantRole | string;
  lastLoginAt: string | null;
  isActive: boolean;
  createdAt: string;
}

// ── Billing (REST /api/v1/billing) ──────────────────────────────────────

export interface BillingPlan {
  tier: SubscriptionTier | string;
  status: 'active' | 'trial' | 'inactive' | string;
  isTrial: boolean;
  amount: string;
  priceLabel: string;
  nextBillingDate: string | null;
  trialEndsAt: string | null;
}

export interface BillingUsage {
  tier: SubscriptionTier | string;
  gmvCurrentMonth: string;
  freeThreshold: string;
  billableGmv: string;
  estimatedFee: string;
}
