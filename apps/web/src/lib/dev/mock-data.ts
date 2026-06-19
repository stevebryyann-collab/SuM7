import type { PaymentTerms } from '@b2b/shared/types';
import type {
  ApplicationPii,
  ArAgingReport,
  BuyerApplication,
  BuyerDetail,
  BuyerSummary,
  InvoiceSummary,
  MerchantDashboard,
  OrderSummary,
  PricingOverrideSummary,
  PricingTierConditions,
  PricingTierSummary,
} from '@/types/api';

/**
 * Deterministic Fashion & Apparel sample data for the dev-only demo merchant.
 * Every value is typed against the same response DTOs the real API returns
 * (`@/types/api`), so the pages render exactly as they would against a live
 * backend. Figures roughly reconcile across views (the AR-aging buckets sum to
 * the dashboard's outstanding/overdue totals).
 *
 * Served ONLY through {@link file://./mock-api.ts} when a demo session is active
 * — see {@link file://./demo.ts} for the production gate.
 */

/** ISO timestamp `dayOffset` days from now (negative = past). */
function iso(dayOffset: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + dayOffset);
  return d.toISOString();
}

// ── Dashboard KPIs (GraphQL getMerchantDashboard) ───────────────────────────

export const DEMO_DASHBOARD: MerchantDashboard = {
  gmvCurrentMonth: '84250.00',
  gmvPreviousMonth: '71980.00',
  gmvChangePercent: '17.05',
  outstandingArBalance: '48230.50',
  overdueInvoiceCount: 3,
  overdueInvoiceAmount: '19840.00',
  newBuyersThisMonth: 4,
  pendingApplicationCount: 3,
};

// ── AR aging (GraphQL getArAging) ───────────────────────────────────────────
// invoiceCount + outstandingAmount reconcile with the dashboard KPIs above:
//   outstanding AR  = 28390.50 + 12450 + 7390 = 48230.50
//   overdue (count) = 2 + 1 + 0 + 0 = 3   overdue (amount) = 12450 + 7390 = 19840

export const DEMO_AR_AGING: ArAgingReport = {
  current: { bucket: 'Current', invoiceCount: 6, outstandingAmount: '28390.50' },
  overdue_1_30: { bucket: '1–30 days', invoiceCount: 2, outstandingAmount: '12450.00' },
  overdue_31_60: { bucket: '31–60 days', invoiceCount: 1, outstandingAmount: '7390.00' },
  overdue_61_90: { bucket: '61–90 days', invoiceCount: 0, outstandingAmount: '0.00' },
  overdue_90_plus: { bucket: '90+ days', invoiceCount: 0, outstandingAmount: '0.00' },
};

// ── Pricing tiers (REST /api/v1/pricing-tiers) ──────────────────────────────

// Tier ids are real UUIDs: the shared ApproveBuyerSchema / UpdateBuyerSchema
// validate pricingTierId as a uuid via zodResolver, so non-UUID demo ids would
// make the approve / inline-edit forms fail client-side validation in demo mode.
export const DEMO_TIER_ID_DEFAULT = '1a2b3c4d-0001-4001-8001-000000000001';
export const DEMO_TIER_ID_VOLUME = '1a2b3c4d-0002-4002-8002-000000000002';
export const DEMO_TIER_ID_KEY = '1a2b3c4d-0003-4003-8003-000000000003';
export const DEMO_TIER_ID_SEASONAL = '1a2b3c4d-0004-4004-8004-000000000004';

export const DEMO_PRICING_TIERS: PricingTierSummary[] = [
  {
    id: DEMO_TIER_ID_DEFAULT,
    name: 'Default Wholesale',
    type: 'percentage_off',
    baseDiscountPct: '20.00',
    isDefault: true,
    minOrderAmount: '250.00',
    priority: 0,
    isActive: true,
    buyerCount: 4,
    createdAt: iso(-210),
  },
  {
    id: DEMO_TIER_ID_VOLUME,
    name: 'Volume Partner',
    type: 'volume_breaks',
    baseDiscountPct: null,
    isDefault: false,
    minOrderAmount: '1000.00',
    priority: 10,
    isActive: true,
    buyerCount: 2,
    createdAt: iso(-180),
  },
  {
    id: DEMO_TIER_ID_KEY,
    name: 'Key Account',
    type: 'fixed_price_list',
    baseDiscountPct: null,
    isDefault: false,
    minOrderAmount: null,
    priority: 20,
    isActive: true,
    buyerCount: 1,
    createdAt: iso(-150),
  },
  {
    id: DEMO_TIER_ID_SEASONAL,
    name: 'Seasonal Clearance',
    type: 'percentage_off',
    baseDiscountPct: '35.00',
    isDefault: false,
    minOrderAmount: null,
    priority: 5,
    isActive: false,
    buyerCount: 0,
    createdAt: iso(-90),
  },
];

// ── Pricing tier detail extras (conditions + per-variant overrides) ─────────
//
// The list endpoint returns only summaries; GET /api/v1/pricing-tiers/:id adds
// the volume-break conditions and a cursor page of overrides. Keyed by tier id;
// the mock backend mutates these on create / update / bulk-override / delete so
// the tier-detail page stays in lockstep with the cards list.

export const DEMO_TIER_CONDITIONS: Record<string, PricingTierConditions | null> = {
  [DEMO_TIER_ID_VOLUME]: {
    brackets: [
      { minQty: 12, discountPct: 10 },
      { minQty: 48, discountPct: 18 },
      { minQty: 144, discountPct: 25 },
    ],
  },
};

function override(
  id: string,
  productId: string,
  variantId: string | null,
  price: string,
  compareAt: string | null,
  createdDaysAgo: number,
): PricingOverrideSummary {
  return {
    id,
    shopifyProductId: productId,
    shopifyVariantId: variantId,
    price,
    compareAtPrice: compareAt,
    currency: 'USD',
    createdAt: iso(-createdDaysAgo),
  };
}

export const DEMO_TIER_OVERRIDES: Record<string, PricingOverrideSummary[]> = {
  [DEMO_TIER_ID_KEY]: [
    override('ovr-01', 'gid://shopify/Product/8801', 'gid://shopify/ProductVariant/41001', '38.00', '52.00', 120),
    override('ovr-02', 'gid://shopify/Product/8802', 'gid://shopify/ProductVariant/41002', '44.50', '60.00', 118),
    override('ovr-03', 'gid://shopify/Product/8803', 'gid://shopify/ProductVariant/41003', '29.00', '39.00', 100),
    override('ovr-04', 'gid://shopify/Product/8804', null, '120.00', '160.00', 80),
  ],
  [DEMO_TIER_ID_DEFAULT]: [
    override('ovr-05', 'gid://shopify/Product/8801', 'gid://shopify/ProductVariant/41001', '41.60', '52.00', 60),
  ],
};

// ── Buyers (REST /buyers) ───────────────────────────────────────────────────

function buyer(
  id: string,
  companyName: string,
  email: string,
  approvalStatus: BuyerSummary['approvalStatus'],
  pricingTierName: string | null,
  paymentTerms: PaymentTerms,
  creditLimit: string | null,
  orderCount: number,
  outstandingInvoiceTotal: string,
  lastOrderDaysAgo: number | null,
  createdDaysAgo: number,
): BuyerSummary {
  return {
    buyerId: id,
    companyName,
    email,
    approvalStatus,
    pricingTierName,
    paymentTerms,
    creditLimit,
    orderCount,
    outstandingInvoiceTotal,
    lastOrderAt: lastOrderDaysAgo === null ? null : iso(-lastOrderDaysAgo),
    createdAt: iso(-createdDaysAgo),
  };
}

export const DEMO_BUYERS: BuyerSummary[] = [
  buyer('buyer-01', 'Maple & Thread Boutique', 'orders@mapleandthread.com', 'approved', 'Default Wholesale', 'net30', '15000.00', 12, '6840.00', 3, 168),
  buyer('buyer-02', 'Coastline Apparel Co.', 'ap@coastlineapparel.com', 'approved', 'Volume Partner', 'net60', '40000.00', 27, '12450.00', 1, 154),
  buyer('buyer-03', 'Northwind Outfitters', 'buying@northwindoutfitters.com', 'approved', 'Key Account', 'net30', '60000.00', 41, '7390.00', 5, 140),
  buyer('buyer-04', 'Velvet & Oak', 'hello@velvetandoak.com', 'approved', 'Default Wholesale', 'net15', '10000.00', 6, '2150.50', 9, 96),
  buyer('buyer-05', 'Harbor Lane Denim', 'accounts@harborlanedenim.com', 'approved', 'Volume Partner', 'net30', '25000.00', 18, '4200.00', 2, 88),
  buyer('buyer-06', 'Solstice Knitwear', 'po@solsticeknit.com', 'approved', 'Default Wholesale', 'immediate', null, 4, '0.00', 21, 64),
  buyer('buyer-07', 'Bramble Street Goods', 'orders@bramblestreet.com', 'suspended', 'Default Wholesale', 'net30', '8000.00', 3, '15800.00', 47, 52),
  buyer('buyer-08', 'Aurora Linen Supply', 'finance@auroralinen.com', 'approved', null, 'net30', '12000.00', 2, '0.00', 14, 33),
];

// ── Buyer detail (REST GET /buyers/:buyerId) ────────────────────────────────
//
// Detail rows carry the per-merchant relationship config the list omits
// (pricingTierId, businessType, notes, approvedAt). Built once from DEMO_BUYERS;
// the mock backend mutates these in lockstep with the summary list on update /
// suspend / reinstate so the View panel and the table never disagree. No PII —
// the buyer detail surface intentionally excludes taxId/phone.

const BUYER_BUSINESS_TYPES: Record<string, string> = {
  'buyer-01': 'Boutique Retailer',
  'buyer-02': 'Apparel Wholesaler',
  'buyer-03': 'Department Store',
  'buyer-04': 'Boutique Retailer',
  'buyer-05': 'Online Retailer',
  'buyer-06': 'Knitwear Studio',
  'buyer-07': 'Boutique Retailer',
  'buyer-08': 'Linen Supplier',
};

const BUYER_NOTES: Record<string, string | null> = {
  'buyer-02': 'Top-volume account — prioritise fulfilment on seasonal drops.',
  'buyer-03': 'Key account. Net 30 negotiated; quarterly business review in place.',
  'buyer-07': 'Suspended after two returned payments. Reinstate only on prepayment.',
};

function tierIdByName(name: string | null): string | null {
  if (!name) return null;
  return DEMO_PRICING_TIERS.find((tier) => tier.name === name)?.id ?? null;
}

export const DEMO_BUYER_DETAILS: Record<string, BuyerDetail> = Object.fromEntries(
  DEMO_BUYERS.map((b): [string, BuyerDetail] => [
    b.buyerId,
    {
      buyerId: b.buyerId,
      companyName: b.companyName,
      email: b.email,
      businessType: BUYER_BUSINESS_TYPES[b.buyerId] ?? null,
      approvalStatus: b.approvalStatus,
      pricingTierId: tierIdByName(b.pricingTierName),
      pricingTierName: b.pricingTierName,
      paymentTerms: b.paymentTerms,
      creditLimit: b.creditLimit,
      notes: BUYER_NOTES[b.buyerId] ?? null,
      orderCount: b.orderCount,
      outstandingInvoiceTotal: b.outstandingInvoiceTotal,
      lastOrderAt: b.lastOrderAt,
      approvedAt: b.approvalStatus === 'pending' ? null : b.createdAt,
      createdAt: b.createdAt,
    },
  ]),
);

// ── Pending registration applications (REST /buyers/applications) ────────────
//
// The seed carries the plaintext PII (taxId, phone) the buyer submitted at apply
// time. The PUBLIC list payload (DEMO_APPLICATIONS) drops it and exposes only
// hasTaxId / hasPhone — matching the API, where plaintext is returned solely by
// the audited reveal endpoint (DEMO_APPLICATION_PII).

interface ApplicationSeed extends Omit<BuyerApplication, 'hasTaxId' | 'hasPhone'> {
  taxId: string | null;
  phone: string | null;
}

// Application ids are real UUIDs — ApproveBuyerSchema / RejectBuyerSchema
// validate applicationId as a uuid through zodResolver (see tier ids above).
const APPLICATION_SEED: ApplicationSeed[] = [
  {
    id: '2b3c4d5e-0001-4001-8001-000000000001',
    email: 'founder@meridianthreads.com',
    companyName: 'Meridian Threads',
    businessType: 'Boutique Retailer',
    website: 'https://meridianthreads.com',
    taxId: '47-1938265',
    phone: '+1 (415) 555-0162',
    estimatedMonthlyOrder: '$5,000 – $10,000',
    message: 'We run three boutiques in the Bay Area and would love to carry your knitwear line for fall.',
    status: 'pending',
    createdAt: iso(-2),
  },
  {
    id: '2b3c4d5e-0002-4002-8002-000000000002',
    email: 'purchasing@cedarcrowco.com',
    companyName: 'Cedar & Crow Co.',
    businessType: 'Online Retailer',
    website: 'https://cedarcrowco.com',
    taxId: '83-2057741',
    phone: '+1 (503) 555-0148',
    estimatedMonthlyOrder: '$10,000 – $25,000',
    message: 'DTC apparel brand expanding into wholesale-sourced basics. Net 30 terms requested.',
    status: 'pending',
    createdAt: iso(-4),
  },
  {
    id: '2b3c4d5e-0003-4003-8003-000000000003',
    email: 'owner@thefoldedge.com',
    companyName: 'The Fold Edge',
    businessType: 'Boutique Retailer',
    website: null,
    taxId: null,
    phone: '+1 (212) 555-0199',
    estimatedMonthlyOrder: '$1,000 – $5,000',
    message: 'Small Brooklyn storefront. Interested in your tailored shirting and chinos.',
    status: 'pending',
    createdAt: iso(-6),
  },
];

/** Public application list — NO plaintext PII (only hasTaxId / hasPhone flags). */
export const DEMO_APPLICATIONS: BuyerApplication[] = APPLICATION_SEED.map(
  ({ taxId, phone, ...rest }) => ({
    ...rest,
    hasTaxId: Boolean(taxId && taxId.length > 0),
    hasPhone: Boolean(phone && phone.length > 0),
  }),
);

/** Audited-reveal lookup: applicationId → plaintext PII. */
export const DEMO_APPLICATION_PII: Record<string, ApplicationPii> = Object.fromEntries(
  APPLICATION_SEED.map((app): [string, ApplicationPii] => [
    app.id,
    { taxId: app.taxId, phone: app.phone },
  ]),
);

// ── Orders (REST /orders) ───────────────────────────────────────────────────

function order(
  n: number,
  company: string,
  status: OrderSummary['status'],
  total: string,
  terms: PaymentTerms,
  placedDaysAgo: number,
  invoiceStatus: string | null,
  dueInDays: number | null,
): OrderSummary {
  const subtotal = (Number(total) / 1.08).toFixed(2);
  const due = dueInDays === null ? null : iso(dueInDays);
  return {
    id: `order-${String(n).padStart(2, '0')}`,
    shopifyOrderNumber: `#WS-${1000 + n}`,
    buyerCompanyName: company,
    status,
    subtotal,
    total,
    currency: 'USD',
    paymentTerms: terms,
    dueDate: due,
    createdAt: iso(-placedDaysAgo),
    invoiceStatus,
    invoiceDueDate: due,
  };
}

export const DEMO_ORDERS: OrderSummary[] = [
  order(1, 'Northwind Outfitters', 'fulfilled', '6480.00', 'net30', 5, 'paid', -25),
  order(2, 'Coastline Apparel Co.', 'fulfilled', '12450.00', 'net60', 1, 'sent', 59),
  order(3, 'Maple & Thread Boutique', 'confirmed', '3240.00', 'net30', 3, 'sent', 27),
  order(4, 'Harbor Lane Denim', 'fulfilled', '4200.00', 'net30', 2, 'partially_paid', 28),
  order(5, 'Velvet & Oak', 'confirmed', '2150.50', 'net15', 9, 'overdue', -3),
  order(6, 'Bramble Street Goods', 'pending', '15800.00', 'net30', 47, 'overdue', -17),
  order(7, 'Solstice Knitwear', 'fulfilled', '1890.00', 'immediate', 21, 'paid', -21),
  order(8, 'Northwind Outfitters', 'fulfilled', '9120.00', 'net30', 12, 'paid', -18),
  order(9, 'Coastline Apparel Co.', 'fulfilled', '7380.00', 'net60', 18, 'paid', 12),
  order(10, 'Aurora Linen Supply', 'confirmed', '1450.00', 'net30', 14, 'draft', 16),
  order(11, 'Maple & Thread Boutique', 'fulfilled', '3600.00', 'net30', 22, 'paid', -8),
  order(12, 'Harbor Lane Denim', 'cancelled', '2750.00', 'net30', 30, null, null),
  order(13, 'Velvet & Oak', 'fulfilled', '4980.00', 'net15', 26, 'paid', -11),
  order(14, 'Northwind Outfitters', 'confirmed', '11200.00', 'net30', 6, 'sent', 24),
  order(15, 'Solstice Knitwear', 'pending', '980.00', 'immediate', 1, 'draft', 1),
  order(16, 'Coastline Apparel Co.', 'fulfilled', '8640.00', 'net60', 33, 'paid', 27),
];

// ── Invoices (REST /invoices) ───────────────────────────────────────────────

function invoice(
  n: number,
  company: string,
  status: InvoiceSummary['status'],
  total: string,
  amountPaid: string,
  dueInDays: number,
  issuedDaysAgo: number | null,
  lastReminderDaysAgo: number | null,
): InvoiceSummary {
  return {
    id: `invoice-${String(n).padStart(2, '0')}`,
    invoiceNumber: `INV-2026-${String(1000 + n)}`,
    buyerCompanyName: company,
    status,
    total,
    amountPaid,
    dueDate: iso(dueInDays),
    issuedAt: issuedDaysAgo === null ? null : iso(-issuedDaysAgo),
    lastReminderAt: lastReminderDaysAgo === null ? null : iso(-lastReminderDaysAgo),
    createdAt: iso(-(issuedDaysAgo ?? 1)),
  };
}

export const DEMO_INVOICES: InvoiceSummary[] = [
  invoice(1, 'Coastline Apparel Co.', 'sent', '12450.00', '0.00', 59, 1, null),
  invoice(2, 'Maple & Thread Boutique', 'sent', '3240.00', '0.00', 27, 3, null),
  invoice(3, 'Harbor Lane Denim', 'partially_paid', '4200.00', '2000.00', 28, 2, 9),
  invoice(4, 'Velvet & Oak', 'overdue', '2150.50', '0.00', -3, 18, 4),
  invoice(5, 'Bramble Street Goods', 'overdue', '15800.00', '0.00', -17, 47, 12),
  invoice(6, 'Northwind Outfitters', 'paid', '6480.00', '6480.00', -25, 30, null),
  invoice(7, 'Solstice Knitwear', 'paid', '1890.00', '1890.00', -14, 21, null),
  invoice(8, 'Northwind Outfitters', 'paid', '9120.00', '9120.00', -3, 18, null),
  invoice(9, 'Coastline Apparel Co.', 'viewed', '7380.00', '0.00', 12, 18, null),
  invoice(10, 'Aurora Linen Supply', 'draft', '1450.00', '0.00', 16, null, null),
  invoice(11, 'Maple & Thread Boutique', 'paid', '3600.00', '3600.00', -8, 22, null),
  invoice(12, 'Velvet & Oak', 'paid', '4980.00', '4980.00', -11, 26, null),
  invoice(13, 'Northwind Outfitters', 'sent', '11200.00', '0.00', 24, 6, null),
  invoice(14, 'Solstice Knitwear', 'draft', '980.00', '0.00', 1, null, null),
  invoice(15, 'Coastline Apparel Co.', 'paid', '8640.00', '8640.00', -6, 33, null),
  invoice(16, 'Harbor Lane Denim', 'void', '2750.00', '0.00', -2, 30, null),
];
