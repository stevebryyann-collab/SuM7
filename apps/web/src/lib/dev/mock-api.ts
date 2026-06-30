import type { InvoiceStatus, PaginatedResponse } from '@b2b/shared/types';
import type {
  ApproveBuyerInput,
  BulkPricingOverrideInput,
  CreatePricingTierInput,
  InviteTeamMemberInput,
  UpdateBuyerInput,
  UpdateMerchantSettingsInput,
  UpdatePricingTierInput,
  UpdateTeamMemberInput,
} from '@b2b/shared/schemas';
import type { ApiRequestOptions } from '@/lib/api/core';
import { ApiClientError } from '@/lib/api/error';
import type {
  ApplicationPii,
  BuyerDetail,
  BuyerSummary,
  InvoiceSummary,
  PricingOverrideSummary,
  PricingTierDetail,
  PricingTierSummary,
} from '@/types/api';
import {
  DEMO_ANALYTICS,
  DEMO_APPLICATION_PII,
  DEMO_APPLICATIONS,
  DEMO_AR_AGING,
  DEMO_BILLING_PLAN,
  DEMO_BILLING_USAGE,
  DEMO_BUYER_DETAILS,
  DEMO_BUYERS,
  DEMO_DASHBOARD,
  DEMO_DASHBOARD_DATA,
  DEMO_INVOICE_DETAILS,
  DEMO_INVOICES,
  DEMO_ORDER_DETAILS,
  DEMO_ORDERS,
  DEMO_PRICING_TIERS,
  DEMO_SETTINGS,
  DEMO_TEAM,
  DEMO_TIER_CONDITIONS,
  DEMO_TIER_OVERRIDES,
} from './mock-data';

/**
 * One designated demo invoice whose PDF "fails" the integrity check, so the
 * amber integrity-failure toast + blocked-download path can be exercised offline.
 */
const DEMO_INTEGRITY_FAIL_INVOICE_ID = 'invoice-05';

/**
 * In-app mock backend for the dev-only demo merchant. {@link merchantFetch} and
 * {@link merchantGraphQL} delegate here when (and only when) a demo session is
 * active, so the merchant admin renders realistic data with no NestJS / Supabase
 * / Redis running. Responses match the real API's DTOs and the cursor-pagination
 * envelope exactly, so the pages and hooks are unmodified.
 *
 * Mutating routes (approve, suspend, reinstate, update, tier CRUD, overrides)
 * mutate the in-memory fixtures so the demo behaves like a real backend within a
 * session: an approved application disappears from the queue and the new buyer
 * appears in the list; a created tier shows up on the next list fetch; etc. State
 * resets on full page reload (the fixtures are module singletons).
 *
 * Reached only behind the production gate in {@link file://./demo.ts}.
 */

/** Brief artificial latency so loading skeletons render as they would live. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Page size for cursor pagination — small, so the demo exercises "Load more". */
const PAGE_SIZE = 10;

/**
 * Split a fixture array into the cursor-paginated envelope the hooks expect. The
 * cursor is simply the next start index encoded as a string (opaque to callers).
 */
function paginate<T>(items: readonly T[], cursor: string | null): PaginatedResponse<T> {
  const start = cursor ? Number.parseInt(cursor, 10) || 0 : 0;
  const slice = items.slice(start, start + PAGE_SIZE);
  const nextStart = start + PAGE_SIZE;
  const hasNextPage = nextStart < items.length;
  return {
    data: slice,
    pageInfo: {
      hasNextPage,
      endCursor: hasNextPage ? String(nextStart) : null,
    },
  };
}

function notFound(path: string): never {
  throw new ApiClientError({
    statusCode: 404,
    code: 'demo_route_not_found',
    message: `[demo] No mock handler for ${path}`,
  });
}

/** Throw the API's `{ code, message }` envelope as a 409 (mirrors Nest conflicts). */
function conflict(code: string, message: string): never {
  throw new ApiClientError({ statusCode: 409, code, message });
}

/** A bare UUID (v4 where supported). */
function newUuid(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `00000000-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padStart(12, '0')}`;
}

/**
 * A realistic-looking id for entities created during the demo session. Tier ids
 * must be bare UUIDs (they flow through the uuid-validated pricingTierId field on
 * the approve / edit forms), so callers that mint tiers use {@link newUuid}.
 */
function newId(prefix: string): string {
  return `${prefix}-${newUuid()}`;
}

/** Path segment at `index` (0-based, leading slash dropped), or '' when absent. */
function segment(url: string, index: number): string {
  return url.split('/')[index + 1] ?? '';
}

/**
 * Route a merchant REST request to the matching fixture. `path` is the bare API
 * path (e.g. `/orders?cursor=10`); query params drive pagination and filtering.
 */
export async function mockMerchantRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  await delay(120);
  const method = options.method ?? 'GET';
  const [rawPath, rawQuery = ''] = path.split('?');
  const url = rawPath ?? '';
  const query = new URLSearchParams(rawQuery);
  const cursor = query.get('cursor');

  // ── Buyers list ─────────────────────────────────────────────────────────────
  if (url === '/buyers' && method === 'GET') {
    const search = query.get('searchQuery')?.toLowerCase() ?? '';
    const status = query.get('approvalStatus') ?? '';
    const tierId = query.get('pricingTierId') ?? '';
    const tierName = tierId ? DEMO_PRICING_TIERS.find((t) => t.id === tierId)?.name ?? null : null;
    let rows: BuyerSummary[] = [...DEMO_BUYERS];
    if (search) rows = rows.filter((b) => b.companyName.toLowerCase().includes(search));
    if (status) rows = rows.filter((b) => b.approvalStatus === status);
    if (tierId) rows = rows.filter((b) => b.pricingTierName === tierName);
    return paginate(rows, cursor) as T;
  }

  // ── Applications (static path — must precede GET /buyers/:buyerId) ────────────
  if (url === '/buyers/applications' && method === 'GET') {
    const status = query.get('status') ?? 'pending';
    return DEMO_APPLICATIONS.filter((a) => a.status === status) as unknown as T;
  }

  // Approve / reject → 204. Approve also seeds the new approved buyer so the list
  // and detail reflect the decision; both drop the application from the queue.
  if (
    method === 'POST' &&
    /^\/buyers\/applications\/[^/]+\/(approve|reject)$/.test(url)
  ) {
    const appId = segment(url, 2);
    const idx = DEMO_APPLICATIONS.findIndex((a) => a.id === appId);
    const removed = idx >= 0 ? DEMO_APPLICATIONS.splice(idx, 1)[0] : undefined;
    if (removed && url.endsWith('/approve')) {
      const dto = options.body as ApproveBuyerInput;
      const tierName = dto.pricingTierId
        ? DEMO_PRICING_TIERS.find((t) => t.id === dto.pricingTierId)?.name ?? null
        : null;
      const buyerId = newId('buyer');
      const now = new Date().toISOString();
      const summary: BuyerSummary = {
        buyerId,
        companyName: removed.companyName,
        email: removed.email,
        approvalStatus: 'approved',
        pricingTierName: tierName,
        paymentTerms: dto.paymentTerms,
        creditLimit: dto.creditLimit ?? null,
        orderCount: 0,
        outstandingInvoiceTotal: '0.00',
        lastOrderAt: null,
        createdAt: now,
      };
      DEMO_BUYERS.unshift(summary);
      DEMO_BUYER_DETAILS[buyerId] = {
        buyerId,
        companyName: removed.companyName,
        email: removed.email,
        businessType: removed.businessType,
        approvalStatus: 'approved',
        pricingTierId: dto.pricingTierId ?? null,
        pricingTierName: tierName,
        paymentTerms: dto.paymentTerms,
        creditLimit: dto.creditLimit ?? null,
        notes: dto.notes ?? null,
        orderCount: 0,
        outstandingInvoiceTotal: '0.00',
        lastOrderAt: null,
        approvedAt: now,
        createdAt: now,
      };
    }
    return undefined as T;
  }

  // Audited PII reveal → { taxId, phone } (200).
  if (method === 'POST' && /^\/buyers\/applications\/[^/]+\/reveal$/.test(url)) {
    const appId = segment(url, 2);
    const pii: ApplicationPii = DEMO_APPLICATION_PII[appId] ?? { taxId: null, phone: null };
    return pii as T;
  }

  // ── Suspend / reinstate (mutate both summary + detail) ───────────────────────
  if (method === 'POST' && /^\/buyers\/[^/]+\/suspend$/.test(url)) {
    const buyerId = segment(url, 1);
    setBuyerStatus(buyerId, 'suspended');
    return undefined as T;
  }

  if (method === 'POST' && /^\/buyers\/[^/]+\/reinstate$/.test(url)) {
    const buyerId = segment(url, 1);
    const detail = DEMO_BUYER_DETAILS[buyerId];
    const summary = DEMO_BUYERS.find((b) => b.buyerId === buyerId);
    const current = detail?.approvalStatus ?? summary?.approvalStatus ?? 'unknown';
    if (current !== 'suspended') {
      conflict('NOT_SUSPENDED', `Buyer is ${current}, not suspended`);
    }
    setBuyerStatus(buyerId, 'approved');
    return undefined as T;
  }

  // ── Buyer detail + approved-buyer edit ───────────────────────────────────────
  if (method === 'GET' && /^\/buyers\/(?!applications$)[^/]+$/.test(url)) {
    const buyerId = segment(url, 1);
    const detail = DEMO_BUYER_DETAILS[buyerId];
    if (!detail) return notFound(`GET ${url}`);
    return detail as T;
  }

  if (method === 'PATCH' && /^\/buyers\/[^/]+$/.test(url)) {
    const buyerId = segment(url, 1);
    const detail = DEMO_BUYER_DETAILS[buyerId];
    if (!detail) return notFound(`PATCH ${url}`);
    const dto = options.body as UpdateBuyerInput;
    const summary = DEMO_BUYERS.find((b) => b.buyerId === buyerId);

    if (dto.pricingTierId !== undefined) {
      const tierName = dto.pricingTierId
        ? DEMO_PRICING_TIERS.find((t) => t.id === dto.pricingTierId)?.name ?? null
        : null;
      detail.pricingTierId = dto.pricingTierId;
      detail.pricingTierName = tierName;
      if (summary) summary.pricingTierName = tierName;
    }
    if (dto.paymentTerms !== undefined) {
      detail.paymentTerms = dto.paymentTerms;
      if (summary) summary.paymentTerms = dto.paymentTerms;
    }
    if (dto.creditLimit !== undefined) {
      detail.creditLimit = dto.creditLimit;
      if (summary) summary.creditLimit = dto.creditLimit;
    }
    if (dto.notes !== undefined) {
      detail.notes = dto.notes;
    }
    return undefined as T;
  }

  // ── Orders ──────────────────────────────────────────────────────────────────
  if (url === '/orders' && method === 'GET') {
    const status = query.get('status') ?? '';
    const search = query.get('search')?.toLowerCase() ?? '';
    const buyerId = query.get('buyerId') ?? '';
    const buyerName = buyerId ? DEMO_BUYERS.find((b) => b.buyerId === buyerId)?.companyName ?? null : null;
    const dateFrom = query.get('dateFrom');
    const dateTo = query.get('dateTo');
    let rows = [...DEMO_ORDERS];
    if (status) rows = rows.filter((o) => o.status === status);
    if (buyerName) rows = rows.filter((o) => o.buyerCompanyName === buyerName);
    if (search) {
      rows = rows.filter((o) => (o.shopifyOrderNumber ?? '').toLowerCase().includes(search));
    }
    if (dateFrom) rows = rows.filter((o) => o.createdAt >= dateFrom);
    if (dateTo) rows = rows.filter((o) => o.createdAt <= `${dateTo}T23:59:59.999Z`);
    return paginate(rows, cursor) as T;
  }

  if (method === 'GET' && /^\/orders\/[^/]+$/.test(url)) {
    const id = segment(url, 1);
    const detail = DEMO_ORDER_DETAILS[id];
    if (!detail) return notFound(`GET ${url}`);
    return detail as T;
  }

  // ── Invoices ────────────────────────────────────────────────────────────────

  // AR-aging CSV export (static, two-segment — must precede /invoices/:id).
  if (url === '/invoices/ar-aging/export' && method === 'GET') {
    return arAgingCsv() as T;
  }

  if (url === '/invoices' && method === 'GET') {
    const status = query.get('status') ?? '';
    const bucket = query.get('agingBucket') ?? '';
    const search = query.get('search')?.toLowerCase() ?? '';
    const buyerId = query.get('buyerId') ?? '';
    const buyerName = buyerId ? DEMO_BUYERS.find((b) => b.buyerId === buyerId)?.companyName ?? null : null;
    let rows: InvoiceSummary[] = [...DEMO_INVOICES];
    if (status) rows = rows.filter((i) => i.status === status);
    if (bucket) rows = rows.filter((i) => i.status === 'overdue' || i.status === 'partially_paid');
    if (buyerName) rows = rows.filter((i) => i.buyerCompanyName === buyerName);
    if (search) rows = rows.filter((i) => i.invoiceNumber.toLowerCase().includes(search));
    return paginate(rows, cursor) as T;
  }

  if (method === 'PATCH' && /^\/invoices\/[^/]+\/mark-paid$/.test(url)) {
    const id = segment(url, 1);
    const dto = options.body as { amount?: string; reference?: string; paidAt?: string };
    return markInvoicePaid(id, dto) as T;
  }

  if (method === 'PATCH' && /^\/invoices\/[^/]+\/void$/.test(url)) {
    const id = segment(url, 1);
    const reason = (options.body as { reason?: string } | undefined)?.reason ?? 'Voided in demo';
    return voidInvoice(id, reason) as T;
  }

  if (method === 'POST' && /^\/invoices\/[^/]+\/resend$/.test(url)) {
    return { sent: true } as T;
  }

  if (method === 'POST' && /^\/invoices\/[^/]+\/send-reminder$/.test(url)) {
    const id = segment(url, 1);
    return sendInvoiceReminder(id) as T;
  }

  // Integrity-gated PDF download. The designated demo invoice fails the check.
  if (method === 'GET' && /^\/invoices\/[^/]+\/pdf$/.test(url)) {
    const id = segment(url, 1);
    if (!DEMO_INVOICE_DETAILS[id]) return notFound(`GET ${url}`);
    if (id === DEMO_INTEGRITY_FAIL_INVOICE_ID) {
      throw new ApiClientError({
        statusCode: 422,
        code: 'INVOICE_INTEGRITY_FAILED',
        message: 'Invoice PDF integrity check failed. Contact support.',
      });
    }
    return { url: `https://example.com/demo/${id}.pdf` } as T;
  }

  // Invoice detail (single segment; exclude the static `ar-aging` path).
  if (method === 'GET' && /^\/invoices\/(?!ar-aging$)[^/]+$/.test(url)) {
    const id = segment(url, 1);
    const detail = DEMO_INVOICE_DETAILS[id];
    if (!detail) return notFound(`GET ${url}`);
    return detail as T;
  }

  // ── Pricing tiers ─────────────────────────────────────────────────────────────
  if (url === '/api/v1/pricing-tiers' && method === 'GET') {
    return DEMO_PRICING_TIERS as unknown as T;
  }

  if (url === '/api/v1/pricing-tiers' && method === 'POST') {
    const dto = options.body as CreatePricingTierInput;
    const id = newUuid();
    const summary: PricingTierSummary = {
      id,
      name: dto.name,
      type: dto.type,
      baseDiscountPct: dto.baseDiscountPct !== undefined ? dto.baseDiscountPct.toFixed(2) : null,
      isDefault: dto.isDefault,
      minOrderAmount: dto.minOrderAmount ?? null,
      priority: dto.priority,
      isActive: dto.isActive,
      buyerCount: 0,
      createdAt: new Date().toISOString(),
    };
    if (summary.isDefault) {
      for (const tier of DEMO_PRICING_TIERS) tier.isDefault = false;
    }
    DEMO_PRICING_TIERS.unshift(summary);
    DEMO_TIER_CONDITIONS[id] = dto.conditionsJson ?? null;
    DEMO_TIER_OVERRIDES[id] = [];
    return { id } as T;
  }

  // Bulk overrides upsert (more specific than /:id — match first).
  if (method === 'POST' && /^\/api\/v1\/pricing-tiers\/[^/]+\/overrides\/bulk$/.test(url)) {
    const tierId = segment(url, 3);
    if (!DEMO_PRICING_TIERS.some((t) => t.id === tierId)) return notFound(`POST ${url}`);
    const dto = options.body as BulkPricingOverrideInput;
    const list = DEMO_TIER_OVERRIDES[tierId] ?? (DEMO_TIER_OVERRIDES[tierId] = []);
    for (const o of dto.overrides) {
      const variantKey = o.shopifyVariantId ?? '';
      const existing = list.find(
        (x) => x.shopifyProductId === o.shopifyProductId && (x.shopifyVariantId ?? '') === variantKey,
      );
      if (existing) {
        existing.price = o.price;
        existing.compareAtPrice = o.compareAtPrice ?? null;
        existing.currency = o.currency;
      } else {
        list.unshift({
          id: newId('ovr'),
          shopifyProductId: o.shopifyProductId,
          shopifyVariantId: o.shopifyVariantId ?? null,
          price: o.price,
          compareAtPrice: o.compareAtPrice ?? null,
          currency: o.currency,
          createdAt: new Date().toISOString(),
        });
      }
    }
    return { upserted: dto.overrides.length } as T;
  }

  if (method === 'DELETE' && /^\/api\/v1\/pricing-tiers\/[^/]+\/overrides\/[^/]+$/.test(url)) {
    const tierId = segment(url, 3);
    const overrideId = segment(url, 5);
    const list = DEMO_TIER_OVERRIDES[tierId];
    const idx = list ? list.findIndex((o) => o.id === overrideId) : -1;
    if (!list || idx < 0) return notFound(`DELETE ${url}`);
    list.splice(idx, 1);
    return undefined as T;
  }

  if (method === 'GET' && /^\/api\/v1\/pricing-tiers\/[^/]+$/.test(url)) {
    const tierId = segment(url, 3);
    const summary = DEMO_PRICING_TIERS.find((t) => t.id === tierId);
    if (!summary) return notFound(`GET ${url}`);
    const detail: PricingTierDetail = {
      ...summary,
      conditionsJson: DEMO_TIER_CONDITIONS[tierId] ?? null,
      overrides: paginate(DEMO_TIER_OVERRIDES[tierId] ?? [], cursor),
    };
    return detail as T;
  }

  if (method === 'PATCH' && /^\/api\/v1\/pricing-tiers\/[^/]+$/.test(url)) {
    const tierId = segment(url, 3);
    const tier = DEMO_PRICING_TIERS.find((t) => t.id === tierId);
    if (!tier) return notFound(`PATCH ${url}`);
    const dto = options.body as UpdatePricingTierInput;

    if (dto.isDefault === true) {
      for (const t of DEMO_PRICING_TIERS) {
        if (t.id !== tierId) t.isDefault = false;
      }
    }
    if (dto.name !== undefined) tier.name = dto.name;
    if (dto.baseDiscountPct !== undefined) {
      tier.baseDiscountPct = dto.baseDiscountPct === null ? null : dto.baseDiscountPct.toFixed(2);
    }
    if (dto.isDefault !== undefined) tier.isDefault = dto.isDefault;
    if (dto.minOrderAmount !== undefined) tier.minOrderAmount = dto.minOrderAmount;
    if (dto.priority !== undefined) tier.priority = dto.priority;
    if (dto.isActive !== undefined) tier.isActive = dto.isActive;
    if (dto.conditionsJson !== undefined) DEMO_TIER_CONDITIONS[tierId] = dto.conditionsJson ?? null;
    return undefined as T;
  }

  if (method === 'DELETE' && /^\/api\/v1\/pricing-tiers\/[^/]+$/.test(url)) {
    const tierId = segment(url, 3);
    const idx = DEMO_PRICING_TIERS.findIndex((t) => t.id === tierId);
    if (idx < 0) return notFound(`DELETE ${url}`);
    const tier = DEMO_PRICING_TIERS[idx];
    if (tier && tier.buyerCount > 0) {
      conflict('TIER_HAS_ACTIVE_BUYERS', 'Cannot delete a tier with assigned buyers');
    }
    DEMO_PRICING_TIERS.splice(idx, 1);
    delete DEMO_TIER_CONDITIONS[tierId];
    delete DEMO_TIER_OVERRIDES[tierId];
    return undefined as T;
  }

  // ── Dashboard aggregator (Stage 4) ───────────────────────────────────────────
  if (url === '/api/v1/dashboard' && method === 'GET') {
    // Recompute the live bits so approvals / payments reflect in the demo.
    return {
      ...DEMO_DASHBOARD_DATA,
      recentInvoices: DEMO_INVOICES.slice(0, 10),
      pendingApplications: DEMO_APPLICATIONS.slice(0, 5).map((app) => ({
        id: app.id,
        companyName: app.companyName,
        businessType: app.businessType,
        createdAt: app.createdAt,
      })),
      kpis: { ...DEMO_DASHBOARD_DATA.kpis, pendingApplicationCount: DEMO_APPLICATIONS.length },
    } as T;
  }

  // ── Analytics (Stage 4) — export is the static two-segment path, match first ──
  if (url === '/api/v1/analytics/export' && method === 'GET') {
    const type = query.get('type') ?? 'orders';
    if (type === 'gdpr') {
      return {
        queued: true,
        type: 'gdpr',
        message: 'Your data export is being prepared. We will email you when it is ready.',
      } as T;
    }
    return analyticsExportCsv(type) as T;
  }
  if (url === '/api/v1/analytics' && method === 'GET') {
    return DEMO_ANALYTICS as T;
  }

  // ── Settings (Stage 4) ───────────────────────────────────────────────────────
  if (url === '/api/v1/settings' && method === 'GET') {
    return DEMO_SETTINGS as T;
  }
  if (url === '/api/v1/settings' && method === 'PUT') {
    const dto = options.body as UpdateMerchantSettingsInput;
    DEMO_SETTINGS.invoicePrefix = dto.invoicePrefix;
    DEMO_SETTINGS.paymentInstructions = dto.paymentInstructions ?? null;
    DEMO_SETTINGS.notifications = { ...dto.notifications };
    return DEMO_SETTINGS as T;
  }

  // Analytics integration IDs (Part 3 — written through, no echo needed).
  if (url === '/merchants/settings' && method === 'PATCH') {
    return undefined as T;
  }

  // ── Team (Stage 4) — static /invite must precede the /:id matchers ────────────
  if (url === '/api/v1/team' && method === 'GET') {
    return DEMO_TEAM as unknown as T;
  }
  if (url === '/api/v1/team/invite' && method === 'POST') {
    const dto = options.body as InviteTeamMemberInput;
    return { invited: false, comingSoon: true, email: dto.email } as T;
  }
  if (method === 'PATCH' && /^\/api\/v1\/team\/[^/]+$/.test(url)) {
    const id = segment(url, 3);
    const member = DEMO_TEAM.find((m) => m.id === id);
    if (!member) return notFound(`PATCH ${url}`);
    if (member.role === 'owner') conflict('CANNOT_MODIFY_OWNER', 'The owner role cannot be changed');
    const dto = options.body as UpdateTeamMemberInput;
    member.role = dto.role;
    return member as T;
  }
  if (method === 'DELETE' && /^\/api\/v1\/team\/[^/]+$/.test(url)) {
    const id = segment(url, 3);
    const idx = DEMO_TEAM.findIndex((m) => m.id === id);
    if (idx < 0) return notFound(`DELETE ${url}`);
    const member = DEMO_TEAM[idx]!;
    if (member.role === 'owner') conflict('CANNOT_REMOVE_OWNER', 'The owner cannot be removed');
    DEMO_TEAM.splice(idx, 1);
    return undefined as T;
  }

  // ── Billing (Stage 4) ────────────────────────────────────────────────────────
  if (url === '/api/v1/billing/plan' && method === 'GET') {
    return DEMO_BILLING_PLAN as T;
  }
  if (url === '/api/v1/billing/usage' && method === 'GET') {
    return DEMO_BILLING_USAGE as T;
  }
  if (url === '/api/v1/billing/change-plan' && method === 'POST') {
    const dto = options.body as { tier: 'starter' | 'growth' | 'pro' };
    applyDemoPlanChange(dto.tier);
    return { subscriptionId: 'sub_demo_0001', tier: dto.tier } as T;
  }
  if (url === '/api/v1/billing/create-portal-session' && method === 'POST') {
    return { url: 'https://billing.stripe.com/p/session/demo' } as T;
  }

  // ── Sales-rep portal (Part 3) ─────────────────────────────────────────────────
  if (url === '/rep/buyers' && method === 'GET') {
    const search = query.get('search')?.toLowerCase() ?? '';
    let rows = DEMO_BUYERS.filter((b) => b.approvalStatus === 'approved');
    if (search) rows = rows.filter((b) => b.companyName.toLowerCase().includes(search));
    const buyers = rows.map((b) => ({
      buyerId: b.buyerId,
      companyName: b.companyName,
      email: b.email,
      pricingTierName: b.pricingTierName,
      paymentTerms: b.paymentTerms,
      lastOrderAt: b.lastOrderAt,
      totalOrderCount: b.orderCount,
      outstandingBalance: b.outstandingInvoiceTotal,
      creditUsed: '0.00',
      creditLimit: b.creditLimit,
    }));
    return { buyers, nextCursor: null } as T;
  }

  if (url === '/rep/sessions' && method === 'POST') {
    const buyerId = (options.body as { buyerId?: string } | undefined)?.buyerId ?? '';
    const buyer = DEMO_BUYERS.find((b) => b.buyerId === buyerId);
    return {
      sessionToken: newUuid().replace(/-/g, ''),
      expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      buyerCompanyName: buyer?.companyName ?? 'Demo Buyer',
      buyerEmail: buyer?.email ?? 'buyer@example.com',
    } as T;
  }

  if (method === 'DELETE' && /^\/rep\/sessions\/[^/]+$/.test(url)) {
    return { ended: true } as T;
  }

  if (method === 'GET' && /^\/rep\/buyers\/[^/]+\/orders$/.test(url)) {
    const orders = DEMO_ORDERS.slice(0, 8).map((o) => ({
      id: o.id,
      shopifyOrderNumber: o.shopifyOrderNumber,
      createdAt: o.createdAt,
      itemCount: o.itemCount,
      total: o.total,
      currency: o.currency,
      status: o.status,
      syncStatus: o.syncStatus,
      invoiceStatus: o.invoiceStatus,
      invoiceNumber: null,
    }));
    return { orders, nextCursor: null } as T;
  }

  // ── GDPR data export / erasure (Part 3 buyers dropdown) ───────────────────────
  if (method === 'GET' && /^\/api\/v1\/data-export\/gdpr\/[^/]+$/.test(url)) {
    const buyerId = segment(url, 4);
    const buyer = DEMO_BUYERS.find((b) => b.buyerId === buyerId);
    return {
      buyer: {
        companyName: buyer?.companyName ?? 'Demo Buyer',
        email: buyer?.email ?? 'buyer@example.com',
        businessType: 'retailer',
        createdAt: buyer?.createdAt ?? new Date().toISOString(),
      },
      relationship: {
        approvalStatus: buyer?.approvalStatus ?? 'approved',
        pricingTierName: buyer?.pricingTierName ?? null,
        paymentTerms: buyer?.paymentTerms ?? 'net30',
        creditLimit: buyer?.creditLimit ?? null,
      },
      orders: [],
      invoices: [],
      applications: [],
    } as T;
  }
  if (method === 'DELETE' && /^\/api\/v1\/data-export\/gdpr\/[^/]+$/.test(url)) {
    return { erased: true, timestamp: new Date().toISOString() } as T;
  }

  return notFound(`${method} ${url}`);
}

/** Build the analytics CSV export (orders / invoices / buyers) from fixtures. */
function analyticsExportCsv(type: string): string {
  const cell = (v: string): string => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  let lines: string[];
  if (type === 'invoices') {
    lines = ['Invoice Number,Buyer,Status,Total,Amount Paid,Due Date,Created At'];
    for (const i of DEMO_INVOICES) {
      lines.push(
        [cell(i.invoiceNumber), cell(i.buyerCompanyName ?? ''), i.status, i.total, i.amountPaid, i.dueDate.slice(0, 10), i.createdAt].join(','),
      );
    }
  } else if (type === 'buyers') {
    lines = ['Company,Email,Status,Payment Terms,Credit Limit,Created At'];
    for (const b of DEMO_BUYERS) {
      lines.push(
        [cell(b.companyName), cell(b.email), b.approvalStatus, b.paymentTerms, b.creditLimit ?? '', b.createdAt].join(','),
      );
    }
  } else {
    lines = ['Order Number,Buyer,Status,Total,Currency,Created At'];
    for (const o of DEMO_ORDERS) {
      lines.push(
        [cell(o.shopifyOrderNumber ?? ''), cell(o.buyerCompanyName ?? ''), o.status, o.total, o.currency, o.createdAt].join(','),
      );
    }
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** Per-tier billing constants mirrored from the API (BillingService). */
const DEMO_TIER_PRICE: Record<string, string> = { starter: '29.00', growth: '79.00', pro: '199.00' };
const DEMO_TIER_FREE: Record<string, string> = { starter: '20000.00', growth: '50000.00', pro: '150000.00' };
const DEMO_TIER_RATE: Record<string, number> = { starter: 0.005, growth: 0.004, pro: 0.003 };

/** Apply a plan change to the billing fixtures (moves the demo out of trial). */
function applyDemoPlanChange(tier: string): void {
  const price = DEMO_TIER_PRICE[tier] ?? '29.00';
  DEMO_BILLING_PLAN.tier = tier;
  DEMO_BILLING_PLAN.amount = price;
  DEMO_BILLING_PLAN.priceLabel = `$${Number(price)}/mo`;
  DEMO_BILLING_PLAN.status = 'active';
  DEMO_BILLING_PLAN.isTrial = false;

  const free = DEMO_TIER_FREE[tier] ?? '20000.00';
  const billable = Math.max(Number(DEMO_BILLING_USAGE.gmvCurrentMonth) - Number(free), 0);
  DEMO_BILLING_USAGE.tier = tier;
  DEMO_BILLING_USAGE.freeThreshold = free;
  DEMO_BILLING_USAGE.billableGmv = billable.toFixed(2);
  DEMO_BILLING_USAGE.estimatedFee = (billable * (DEMO_TIER_RATE[tier] ?? 0.005)).toFixed(2);
}

/** Flip a buyer's approval status on both the summary row and the detail row. */
function setBuyerStatus(buyerId: string, status: string): void {
  const detail = DEMO_BUYER_DETAILS[buyerId];
  if (detail) detail.approvalStatus = status;
  const summary = DEMO_BUYERS.find((b) => b.buyerId === buyerId);
  if (summary) summary.approvalStatus = status;
}

/** Record a (partial) payment on an invoice, mutating summary + detail in lockstep. */
function markInvoicePaid(
  id: string,
  dto: { amount?: string; reference?: string; paidAt?: string },
): { id: string; status: InvoiceStatus; amountPaid: string } {
  const summary = DEMO_INVOICES.find((i) => i.id === id);
  const detail = DEMO_INVOICE_DETAILS[id];
  if (!summary && !detail) return notFound(`PATCH /invoices/${id}/mark-paid`);
  const total = Number(summary?.total ?? detail?.total ?? '0');
  const prevPaid = Number(summary?.amountPaid ?? detail?.amountPaid ?? '0');
  const payment = Number(dto.amount ?? '0');
  const newPaid = Math.min(prevPaid + (Number.isFinite(payment) ? payment : 0), total);
  const fullyPaid = newPaid >= total - 0.005;
  const status: InvoiceStatus = fullyPaid ? 'paid' : 'partially_paid';
  const paidAtIso = dto.paidAt ?? new Date().toISOString();
  const amountPaidStr = newPaid.toFixed(2);

  if (summary) {
    summary.status = status;
    summary.amountPaid = amountPaidStr;
  }
  if (detail) {
    detail.status = status;
    detail.amountPaid = amountPaidStr;
    detail.outstanding = Math.max(total - newPaid, 0).toFixed(2);
    detail.paidAt = fullyPaid ? paidAtIso : detail.paidAt;
    detail.payments = [
      ...detail.payments,
      {
        amount: (newPaid - prevPaid).toFixed(2),
        paidAt: paidAtIso,
        reference: dto.reference ?? null,
        recordedBy: 'Demo Owner',
      },
    ];
    detail.auditTrail = [
      { id: `aud-${id}-paid-${detail.payments.length}`, action: 'paid', actorType: 'merchant_user', actorLabel: 'Demo Owner', createdAt: paidAtIso },
      ...detail.auditTrail,
    ];
  }
  return { id, status, amountPaid: amountPaidStr };
}

/** Void an invoice, mutating summary + detail in lockstep. */
function voidInvoice(id: string, reason: string): { id: string; status: InvoiceStatus } {
  const summary = DEMO_INVOICES.find((i) => i.id === id);
  const detail = DEMO_INVOICE_DETAILS[id];
  if (!summary && !detail) return notFound(`PATCH /invoices/${id}/void`);
  if (summary?.status === 'paid' || summary?.status === 'void') {
    conflict('INVOICE_NOT_VOIDABLE', `Invoice is ${summary.status} and cannot be voided`);
  }
  const nowIso = new Date().toISOString();
  if (summary) summary.status = 'void';
  if (detail) {
    detail.status = 'void';
    detail.voidedAt = nowIso;
    detail.voidReason = reason;
    detail.auditTrail = [
      { id: `aud-${id}-void`, action: 'voided', actorType: 'merchant_user', actorLabel: 'Demo Owner', createdAt: nowIso },
      ...detail.auditTrail,
    ];
  }
  return { id, status: 'void' };
}

/** Send the next reminder for an invoice, enforcing the 3-max rule in the demo. */
function sendInvoiceReminder(id: string): { sent: boolean; reminderCount: number } {
  const summary = DEMO_INVOICES.find((i) => i.id === id);
  const detail = DEMO_INVOICE_DETAILS[id];
  if (!summary && !detail) return notFound(`POST /invoices/${id}/send-reminder`);
  const current = summary?.reminderCount ?? detail?.reminderCount ?? 0;
  if (current >= 3) {
    conflict('REMINDER_LIMIT_REACHED', 'The maximum of 3 reminders has already been sent');
  }
  const next = current + 1;
  const nowIso = new Date().toISOString();
  if (summary) {
    summary.reminderCount = next;
    summary.lastReminderAt = nowIso;
  }
  if (detail) {
    detail.reminderCount = next;
    detail.lastReminderAt = nowIso;
    detail.auditTrail = [
      { id: `aud-${id}-reminder-${next}`, action: 'reminder_sent', actorType: 'merchant_user', actorLabel: 'Demo Owner', createdAt: nowIso },
      ...detail.auditTrail,
    ];
  }
  return { sent: true, reminderCount: next };
}

/** Build the AR-aging CSV from the demo aging fixture (mirrors the API export). */
function arAgingCsv(): string {
  const rows: Array<[string, number, string]> = [
    ['Current (not yet due)', DEMO_AR_AGING.current.invoiceCount, DEMO_AR_AGING.current.outstandingAmount],
    ['1–30 days overdue', DEMO_AR_AGING.overdue_1_30.invoiceCount, DEMO_AR_AGING.overdue_1_30.outstandingAmount],
    ['31–60 days overdue', DEMO_AR_AGING.overdue_31_60.invoiceCount, DEMO_AR_AGING.overdue_31_60.outstandingAmount],
    ['61–90 days overdue', DEMO_AR_AGING.overdue_61_90.invoiceCount, DEMO_AR_AGING.overdue_61_90.outstandingAmount],
    ['90+ days overdue', DEMO_AR_AGING.overdue_90_plus.invoiceCount, DEMO_AR_AGING.overdue_90_plus.outstandingAmount],
  ];
  const totalCount = rows.reduce((acc, [, count]) => acc + count, 0);
  const totalAmount = rows.reduce((acc, [, , amount]) => acc + Number(amount), 0).toFixed(2);
  const cell = (v: string): string => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = ['Bucket,Invoices,Outstanding'];
  for (const [label, count, amount] of rows) lines.push(`${cell(label)},${count},${amount}`);
  lines.push(`${cell('Total')},${totalCount},${totalAmount}`);
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * Route a merchant GraphQL document to the matching fixture by inspecting the
 * query body (the dashboard uses exactly two queries).
 */
export async function mockMerchantGraphQL<TData>(document: string): Promise<TData> {
  await delay(120);
  if (document.includes('getMerchantDashboard')) {
    return { getMerchantDashboard: DEMO_DASHBOARD } as TData;
  }
  if (document.includes('getArAging')) {
    return { getArAging: DEMO_AR_AGING } as TData;
  }
  throw new ApiClientError({
    statusCode: 400,
    code: 'demo_graphql_unknown',
    message: '[demo] Unrecognized GraphQL document',
  });
}
