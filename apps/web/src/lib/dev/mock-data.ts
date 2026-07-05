import type { PaymentTerms } from '@b2b/shared/types';
import type {
  AnalyticsData,
  AnalyticsMonthlyRow,
  AnalyticsTopBuyer,
  ApplicationPii,
  ArAgingReport,
  BillingPlan,
  BillingUsage,
  BuyerApplication,
  BuyerDetail,
  BuyerSummary,
  DashboardData,
  InvoiceAuditEntry,
  InvoiceDetail,
  InvoiceLineDetail,
  InvoicePayment,
  InvoiceSummary,
  MerchantDashboard,
  MerchantSettings,
  OrderDetail,
  OrderLineDetail,
  OrderSummary,
  PricingOverrideSummary,
  PricingTierConditions,
  PricingTierSummary,
  TeamMember,
} from '@/types/api';
import { DEMO_EMAIL, DEMO_MERCHANT_USER_ID, DEMO_SHOP_DOMAIN } from './demo';

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
  allTimeGmv: '512400.00',
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

// `conditionsJson`/`overrideCount` below are placeholders — the mock API's
// list handler recomputes both fresh from DEMO_TIER_CONDITIONS/DEMO_TIER_OVERRIDES
// on every read (mirroring the real backend's query-time subqueries), so these
// two fields never actually reach the frontend as declared here.
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
    conditionsJson: null,
    overrideCount: 0,
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
    conditionsJson: null,
    overrideCount: 0,
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
    conditionsJson: null,
    overrideCount: 0,
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
    conditionsJson: null,
    overrideCount: 0,
    createdAt: iso(-90),
  },
];

// ── Pricing tier detail extras (conditions + per-variant overrides) ─────────
//
// The list endpoint returns only summaries; GET /api/v1/pricing-tiers/:id adds
// the volume-break conditions and a cursor page of overrides. Keyed by tier id;
// the mock backend mutates these on create / update / bulk-override / delete so
// the tier list and detail page stay in lockstep.

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
  syncStatus: OrderSummary['syncStatus'],
  itemCount: number,
): OrderSummary {
  const subtotal = (Number(total) / 1.08).toFixed(2);
  const due = dueInDays === null ? null : iso(dueInDays);
  return {
    id: `order-${String(n).padStart(2, '0')}`,
    shopifyOrderNumber: `#WS-${1000 + n}`,
    buyerCompanyName: company,
    status,
    syncStatus,
    itemCount,
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
  order(1, 'Northwind Outfitters', 'fulfilled', '6480.00', 'net30', 5, 'paid', -25, 'synced', 4),
  order(2, 'Coastline Apparel Co.', 'fulfilled', '12450.00', 'net60', 1, 'sent', 59, 'synced', 6),
  order(3, 'Maple & Thread Boutique', 'confirmed', '3240.00', 'net30', 3, 'sent', 27, 'synced', 3),
  order(4, 'Harbor Lane Denim', 'fulfilled', '4200.00', 'net30', 2, 'partially_paid', 28, 'synced', 5),
  order(5, 'Velvet & Oak', 'confirmed', '2150.50', 'net15', 9, 'overdue', -3, 'synced', 2),
  order(6, 'Bramble Street Goods', 'pending', '15800.00', 'net30', 47, 'overdue', -17, 'shopify_orphan', 8),
  order(7, 'Solstice Knitwear', 'fulfilled', '1890.00', 'immediate', 21, 'paid', -21, 'synced', 2),
  order(8, 'Northwind Outfitters', 'fulfilled', '9120.00', 'net30', 12, 'paid', -18, 'synced', 5),
  order(9, 'Coastline Apparel Co.', 'fulfilled', '7380.00', 'net60', 18, 'paid', 12, 'synced', 4),
  order(10, 'Aurora Linen Supply', 'confirmed', '1450.00', 'net30', 14, 'draft', 16, 'sync_pending', 2),
  order(11, 'Maple & Thread Boutique', 'fulfilled', '3600.00', 'net30', 22, 'paid', -8, 'synced', 3),
  order(12, 'Harbor Lane Denim', 'cancelled', '2750.00', 'net30', 30, null, null, 'synced', 3),
  order(13, 'Velvet & Oak', 'fulfilled', '4980.00', 'net15', 26, 'paid', -11, 'synced', 4),
  order(14, 'Northwind Outfitters', 'confirmed', '11200.00', 'net30', 6, 'sent', 24, 'synced', 7),
  order(15, 'Solstice Knitwear', 'pending', '980.00', 'immediate', 1, 'draft', 1, 'sync_pending', 1),
  order(16, 'Coastline Apparel Co.', 'fulfilled', '8640.00', 'net60', 33, 'paid', 27, 'synced', 5),
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
  reminderCount: number,
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
    reminderCount,
    createdAt: iso(-(issuedDaysAgo ?? 1)),
  };
}

export const DEMO_INVOICES: InvoiceSummary[] = [
  invoice(1, 'Coastline Apparel Co.', 'sent', '12450.00', '0.00', 59, 1, null, 0),
  invoice(2, 'Maple & Thread Boutique', 'sent', '3240.00', '0.00', 27, 3, null, 0),
  invoice(3, 'Harbor Lane Denim', 'partially_paid', '4200.00', '2000.00', 28, 2, 9, 1),
  invoice(4, 'Velvet & Oak', 'overdue', '2150.50', '0.00', -3, 18, 4, 1),
  invoice(5, 'Bramble Street Goods', 'overdue', '15800.00', '0.00', -17, 47, 12, 2),
  invoice(6, 'Northwind Outfitters', 'paid', '6480.00', '6480.00', -25, 30, null, 0),
  invoice(7, 'Solstice Knitwear', 'paid', '1890.00', '1890.00', -14, 21, null, 0),
  invoice(8, 'Northwind Outfitters', 'paid', '9120.00', '9120.00', -3, 18, null, 0),
  invoice(9, 'Coastline Apparel Co.', 'viewed', '7380.00', '0.00', 12, 18, null, 0),
  invoice(10, 'Aurora Linen Supply', 'draft', '1450.00', '0.00', 16, null, null, 0),
  invoice(11, 'Maple & Thread Boutique', 'paid', '3600.00', '3600.00', -8, 22, null, 0),
  invoice(12, 'Velvet & Oak', 'paid', '4980.00', '4980.00', -11, 26, null, 0),
  invoice(13, 'Northwind Outfitters', 'sent', '11200.00', '0.00', 24, 6, null, 0),
  invoice(14, 'Solstice Knitwear', 'draft', '980.00', '0.00', 1, null, null, 0),
  invoice(15, 'Coastline Apparel Co.', 'paid', '8640.00', '8640.00', -6, 33, null, 0),
  invoice(16, 'Harbor Lane Denim', 'void', '2750.00', '0.00', -2, 30, null, 0),
];

// ── Order + invoice detail (REST GET /orders/:id, GET /invoices/:id) ─────────
//
// The list endpoints return summaries; the detail endpoints add line items and
// (for invoices) the derived payment history + audit trail. Everything is built
// deterministically from the summary fixtures so the totals reconcile with the
// list and the order ⇆ invoice cross-links resolve to real ids in the demo.

/** A tiny apparel catalog used to synthesize believable line items. */
const CATALOG: Array<{ product: string; variant: string; sku: string }> = [
  { product: 'Merino Crew Sweater', variant: 'Oatmeal / M', sku: 'MCS-OAT-M' },
  { product: 'Tailored Oxford Shirt', variant: 'White / L', sku: 'TOS-WHT-L' },
  { product: 'Selvedge Denim Jean', variant: 'Indigo / 32', sku: 'SDJ-IND-32' },
  { product: 'Lambswool Beanie', variant: 'Charcoal', sku: 'LWB-CHR' },
  { product: 'Cotton Chino', variant: 'Stone / 34', sku: 'CCH-STN-34' },
  { product: 'Linen Camp Shirt', variant: 'Sage / M', sku: 'LCS-SAG-M' },
  { product: 'Cashmere Scarf', variant: 'Camel', sku: 'CSF-CAM' },
  { product: 'Quilted Field Jacket', variant: 'Olive / L', sku: 'QFJ-OLV-L' },
];

const ORDER_TIER_TYPES: ReadonlyArray<string | null> = [
  'percentage_off',
  'volume_breaks',
  'fixed_price_list',
  null,
];

/** Split `subtotal` into `count` line totals (2dp) that sum exactly to it. */
function splitTotal(subtotal: number, count: number): number[] {
  const n = Math.max(1, count);
  const cents = Math.round(subtotal * 100);
  const base = Math.floor(cents / n);
  const parts: number[] = Array.from({ length: n }, () => base);
  let remainder = cents - base * n;
  let i = 0;
  while (remainder > 0) {
    parts[i] = (parts[i] ?? 0) + 1;
    i = (i + 1) % n;
    remainder -= 1;
  }
  return parts.map((c) => c / 100);
}

function buildOrderLines(subtotal: number, count: number, seed: number, currency: string): OrderLineDetail[] {
  return splitTotal(subtotal, count).map((lineTotal, i) => {
    const item = CATALOG[(seed + i) % CATALOG.length] ?? CATALOG[0]!;
    const quantity = 6 + ((seed + i) % 4) * 6; // 6, 12, 18 or 24
    const unitPrice = quantity > 0 ? lineTotal / quantity : lineTotal;
    const tierType = ORDER_TIER_TYPES[(seed + i) % ORDER_TIER_TYPES.length] ?? null;
    const discountPct =
      tierType === 'percentage_off' ? '20.00' : tierType === 'volume_breaks' ? '12.00' : null;
    return {
      shopifyVariantId: `gid://shopify/ProductVariant/${42000 + seed * 10 + i}`,
      shopifyProductId: `gid://shopify/Product/${8900 + seed * 10 + i}`,
      productTitle: item.product,
      variantTitle: item.variant,
      sku: item.sku,
      quantity,
      unitPrice: unitPrice.toFixed(2),
      lineTotal: lineTotal.toFixed(2),
      appliedTierType: tierType,
      discountPct,
      currency,
    };
  });
}

function buyerIdForCompany(company: string | null): string {
  return DEMO_BUYERS.find((b) => b.companyName === company)?.buyerId ?? 'buyer-01';
}

function buyerEmailForCompany(company: string | null): string | null {
  return DEMO_BUYERS.find((b) => b.companyName === company)?.email ?? null;
}

/** Generic bill-to address lines (no PII) for the demo detail views. */
const DEMO_ADDRESS_LINES = ['128 Market Street, Suite 400', 'San Francisco, CA, 94105', 'United States'];

function seedFromId(id: string): number {
  const n = Number.parseInt(id.replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : 1;
}

function invoiceLinkForOrder(summary: OrderSummary): OrderDetail['invoice'] {
  const match = DEMO_INVOICES.find(
    (inv) => inv.buyerCompanyName === summary.buyerCompanyName && inv.total === summary.total,
  );
  if (!match) return null;
  return {
    id: match.id,
    invoiceNumber: match.invoiceNumber,
    status: match.status,
    dueDate: match.dueDate,
    total: match.total,
    amountPaid: match.amountPaid,
  };
}

function buildOrderDetail(summary: OrderSummary): OrderDetail {
  const subtotal = Number(summary.subtotal);
  const tax = (Number(summary.total) - subtotal).toFixed(2);
  const seed = seedFromId(summary.id);
  return {
    id: summary.id,
    shopifyOrderId: String(5500000000 + seed),
    shopifyOrderNumber: summary.shopifyOrderNumber,
    buyerId: buyerIdForCompany(summary.buyerCompanyName),
    buyerCompanyName: summary.buyerCompanyName,
    status: summary.status,
    syncStatus: summary.syncStatus,
    subtotal: summary.subtotal,
    taxAmount: tax,
    shippingAmount: '0.00',
    total: summary.total,
    currency: summary.currency,
    paymentTerms: summary.paymentTerms,
    dueDate: summary.dueDate,
    notes: null,
    createdAt: summary.createdAt,
    containsBackOrder: false,
    trackingNumber: summary.status === 'fulfilled' ? `1Z999AA1${String(1000000 + seed).slice(0, 7)}` : null,
    trackingUrl: summary.status === 'fulfilled' ? 'https://www.ups.com/track' : null,
    fulfillmentService: summary.status === 'fulfilled' ? 'UPS' : null,
    shippedAt: summary.status === 'fulfilled' ? summary.createdAt : null,
    estimatedDeliveryAt: null,
    lineItems: buildOrderLines(subtotal, summary.itemCount, seed, summary.currency),
    invoice: invoiceLinkForOrder(summary),
  };
}

export const DEMO_ORDER_DETAILS: Record<string, OrderDetail> = Object.fromEntries(
  DEMO_ORDERS.map((o): [string, OrderDetail] => [o.id, buildOrderDetail(o)]),
);

function buildInvoiceDetail(summary: InvoiceSummary): InvoiceDetail {
  const subtotal = Number(summary.total) / 1.08;
  const tax = (Number(summary.total) - subtotal).toFixed(2);
  const seed = seedFromId(summary.id);
  const order = DEMO_ORDERS.find(
    (o) => o.buyerCompanyName === summary.buyerCompanyName && o.total === summary.total,
  );
  const itemCount = order?.itemCount ?? 3;
  const lineItems: InvoiceLineDetail[] = buildOrderLines(subtotal, itemCount, seed, 'USD').map((li) => ({
    productTitle: li.productTitle,
    variantTitle: li.variantTitle,
    sku: li.sku,
    quantity: li.quantity,
    unitPrice: li.unitPrice,
    lineTotal: li.lineTotal,
  }));

  const paidAtIso = summary.lastReminderAt ?? summary.issuedAt ?? summary.createdAt;
  const payments: InvoicePayment[] = [];
  if (Number(summary.amountPaid) > 0) {
    payments.push({
      amount: summary.amountPaid,
      paidAt: paidAtIso,
      reference: summary.status === 'partially_paid' ? 'ACH-PARTIAL-0098' : 'WIRE-7741',
      recordedBy: 'Demo Owner',
    });
  }

  const audit: InvoiceAuditEntry[] = [
    { id: `aud-${seed}-created`, action: 'created', actorType: 'system', actorLabel: null, createdAt: summary.createdAt },
  ];
  if (summary.issuedAt) {
    audit.push({ id: `aud-${seed}-sent`, action: 'sent', actorType: 'system', actorLabel: null, createdAt: summary.issuedAt });
  }
  if (summary.reminderCount > 0 && summary.lastReminderAt) {
    audit.push({
      id: `aud-${seed}-reminder`,
      action: 'reminder_sent',
      actorType: 'merchant_user',
      actorLabel: 'Demo Owner',
      createdAt: summary.lastReminderAt,
    });
  }
  if (payments.length > 0) {
    audit.push({
      id: `aud-${seed}-paid`,
      action: 'paid',
      actorType: 'merchant_user',
      actorLabel: 'Demo Owner',
      createdAt: paidAtIso,
    });
  }
  if (summary.status === 'void') {
    audit.push({
      id: `aud-${seed}-void`,
      action: 'voided',
      actorType: 'merchant_user',
      actorLabel: 'Demo Owner',
      createdAt: summary.issuedAt ?? summary.createdAt,
    });
  }
  audit.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const outstanding = Math.max(Number(summary.total) - Number(summary.amountPaid), 0).toFixed(2);

  return {
    id: summary.id,
    invoiceNumber: summary.invoiceNumber,
    status: summary.status,
    orderId: order?.id ?? null,
    shopifyOrderNumber: order?.shopifyOrderNumber ?? null,
    buyerId: buyerIdForCompany(summary.buyerCompanyName),
    buyerCompanyName: summary.buyerCompanyName,
    buyerEmail: buyerEmailForCompany(summary.buyerCompanyName),
    buyerAddressLines: DEMO_ADDRESS_LINES,
    merchantName: DEMO_SHOP_DOMAIN,
    invoiceDate: summary.issuedAt ?? summary.createdAt,
    dueDate: summary.dueDate,
    paymentTerms: order?.paymentTerms ?? 'net30',
    subtotal: subtotal.toFixed(2),
    taxAmount: tax,
    total: summary.total,
    amountPaid: summary.amountPaid,
    outstanding,
    currency: 'USD',
    sentAt: summary.issuedAt,
    firstViewedAt: summary.status === 'viewed' || summary.status === 'paid' ? summary.issuedAt : null,
    paidAt: summary.status === 'paid' ? paidAtIso : null,
    voidedAt: summary.status === 'void' ? (summary.issuedAt ?? summary.createdAt) : null,
    voidReason: summary.status === 'void' ? 'Duplicate of a corrected invoice.' : null,
    reminderCount: summary.reminderCount,
    lastReminderAt: summary.lastReminderAt,
    createdAt: summary.createdAt,
    lineItems,
    payments,
    auditTrail: audit,
  };
}

export const DEMO_INVOICE_DETAILS: Record<string, InvoiceDetail> = Object.fromEntries(
  DEMO_INVOICES.map((inv): [string, InvoiceDetail] => [inv.id, buildInvoiceDetail(inv)]),
);

// ── Stage 4: dashboard aggregator / analytics / settings / team / billing ────
//
// These mirror the new REST DTOs (DashboardData, AnalyticsData, MerchantSettings,
// TeamMember, BillingPlan, BillingUsage). Figures reconcile with the existing
// KPI / AR-aging fixtures above so the dashboard, analytics and billing pages
// stay internally consistent in the demo session.

/** `YYYY-MM-DD` key `offset` days from today. */
function dayKey(offset: number): string {
  return iso(offset).slice(0, 10);
}

/** `YYYY-MM` key `offset` months from this month. */
function monthKey(offset: number): string {
  const now = new Date();
  const m = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
}

/** Deterministic 30-day daily GMV + order-count series (no RNG — index waves). */
function buildDailyTrend(): { date: string; gmv: string; orderCount: number }[] {
  return Array.from({ length: 30 }, (_, i) => {
    const wave = Math.sin(i / 3) * 700 + Math.cos(i / 5) * 450;
    const gmv = Math.max(0, Math.round(1900 + wave + (i % 7) * 130));
    const orderCount = Math.max(0, Math.round(3 + Math.sin(i / 2) * 2));
    return { date: dayKey(-(29 - i)), gmv: gmv.toFixed(2), orderCount };
  });
}

const DEMO_DAILY_TREND = buildDailyTrend();

/** Trailing-12-month GMV table with a stand-in YoY for the recent half. */
function buildMonthly(): AnalyticsMonthlyRow[] {
  const base = [42000, 38500, 51000, 47800, 53200, 60100, 58700, 64900, 71980, 69500, 78400, 84250];
  return base.map((gmv, i) => {
    const orders = 24 + ((i * 5) % 17);
    const avg = orders > 0 ? gmv / orders : 0;
    const prior = i >= 6 ? base[i - 6] : null;
    const yoy = prior && prior > 0 ? (((gmv - prior) / prior) * 100).toFixed(2) : null;
    return {
      month: monthKey(-(11 - i)),
      gmv: gmv.toFixed(2),
      orders,
      avgOrder: avg.toFixed(2),
      yoyChangePct: yoy,
    };
  });
}

export const DEMO_DASHBOARD_DATA: DashboardData = {
  kpis: {
    gmvCurrentMonth: DEMO_DASHBOARD.gmvCurrentMonth,
    gmvPreviousMonth: DEMO_DASHBOARD.gmvPreviousMonth,
    gmvChangePercent: DEMO_DASHBOARD.gmvChangePercent,
    outstandingArBalance: DEMO_DASHBOARD.outstandingArBalance,
    outstandingInvoiceCount: 7,
    overdueInvoiceCount: DEMO_DASHBOARD.overdueInvoiceCount,
    overdueInvoiceAmount: DEMO_DASHBOARD.overdueInvoiceAmount,
    newBuyersThisMonth: DEMO_DASHBOARD.newBuyersThisMonth,
    pendingApplicationCount: DEMO_DASHBOARD.pendingApplicationCount,
  },
  aging: DEMO_AR_AGING,
  gmvTrend: DEMO_DAILY_TREND.map(({ date, gmv }) => ({ date, gmv })),
  recentInvoices: DEMO_INVOICES.slice(0, 10),
  pendingApplications: DEMO_APPLICATIONS.slice(0, 5).map((app) => ({
    id: app.id,
    companyName: app.companyName,
    businessType: app.businessType,
    createdAt: app.createdAt,
  })),
  // hasSubscription false so the demo shows the trial banner + billing checklist step.
  setup: { hasTier: true, hasApprovedBuyer: true, hasSubscription: false },
};

function topBuyer(buyer: BuyerSummary, gmv: number, orderCount: number): AnalyticsTopBuyer {
  const avg = orderCount > 0 ? gmv / orderCount : 0;
  return {
    buyerId: buyer.buyerId,
    companyName: buyer.companyName,
    gmv: gmv.toFixed(2),
    orderCount,
    avgOrderValue: avg.toFixed(2),
  };
}

export const DEMO_ANALYTICS: AnalyticsData = {
  range: { from: iso(-29), to: iso(0) },
  kpis: { gmv: '84250.00', orders: 47, avgOrderValue: '1792.55', activeBuyers: 7 },
  trend: DEMO_DAILY_TREND,
  topBuyers: [
    topBuyer(DEMO_BUYERS[2]!, 22300, 41), // Northwind Outfitters
    topBuyer(DEMO_BUYERS[1]!, 18640, 27), // Coastline Apparel Co.
    topBuyer(DEMO_BUYERS[0]!, 9840, 12), // Maple & Thread Boutique
    topBuyer(DEMO_BUYERS[4]!, 8400, 18), // Harbor Lane Denim
    topBuyer(DEMO_BUYERS[3]!, 7130, 6), // Velvet & Oak
    topBuyer(DEMO_BUYERS[5]!, 1890, 4), // Solstice Knitwear
  ],
  monthly: buildMonthly(),
};

export const DEMO_SETTINGS: MerchantSettings = {
  storeName: DEMO_SHOP_DOMAIN.split('.')[0] ?? DEMO_SHOP_DOMAIN,
  shopifyDomain: DEMO_SHOP_DOMAIN,
  platformDomain: 'app.wholesaleportal.dev',
  applicationLink: `https://${DEMO_SHOP_DOMAIN}/apps/wholesale`,
  invoicePrefix: 'INV',
  paymentInstructions:
    'Remit by ACH to Account 0123456789 / Routing 110000000, or by check to Demo Fashion Co., 128 Market Street, San Francisco, CA 94105. Reference your invoice number.',
  notifications: { newApplication: true, invoiceOverdue: true, paymentReceived: false },
};

export const DEMO_TEAM: TeamMember[] = [
  {
    id: DEMO_MERCHANT_USER_ID,
    email: DEMO_EMAIL,
    firstName: 'Demo',
    lastName: 'Owner',
    role: 'owner',
    lastLoginAt: iso(0),
    isActive: true,
    createdAt: iso(-210),
  },
  {
    id: '7c9e1a40-0001-4001-8001-000000000001',
    email: 'ops@demo-fashion.myshopify.com',
    firstName: 'Riley',
    lastName: 'Chen',
    role: 'admin',
    lastLoginAt: iso(-1),
    isActive: true,
    createdAt: iso(-120),
  },
  {
    id: '7c9e1a40-0002-4002-8002-000000000002',
    email: 'warehouse@demo-fashion.myshopify.com',
    firstName: 'Sam',
    lastName: 'Okafor',
    role: 'staff',
    lastLoginAt: iso(-5),
    isActive: true,
    createdAt: iso(-60),
  },
];

export const DEMO_BILLING_PLAN: BillingPlan = {
  tier: 'starter',
  status: 'trial',
  isTrial: true,
  amount: '29.00',
  priceLabel: '$29/mo',
  nextBillingDate: iso(9),
  trialEndsAt: iso(9),
};

export const DEMO_BILLING_USAGE: BillingUsage = {
  tier: 'starter',
  gmvCurrentMonth: '84250.00',
  freeThreshold: '20000.00',
  billableGmv: '64250.00',
  estimatedFee: '321.25',
};
