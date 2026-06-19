import type { InvoiceStatus, PaginatedResponse } from '@b2b/shared/types';
import type {
  ApproveBuyerInput,
  BulkPricingOverrideInput,
  CreatePricingTierInput,
  UpdateBuyerInput,
  UpdatePricingTierInput,
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
  DEMO_APPLICATION_PII,
  DEMO_APPLICATIONS,
  DEMO_AR_AGING,
  DEMO_BUYER_DETAILS,
  DEMO_BUYERS,
  DEMO_DASHBOARD,
  DEMO_INVOICES,
  DEMO_ORDERS,
  DEMO_PRICING_TIERS,
  DEMO_TIER_CONDITIONS,
  DEMO_TIER_OVERRIDES,
} from './mock-data';

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
    const rows = status ? DEMO_ORDERS.filter((o) => o.status === status) : DEMO_ORDERS;
    return paginate(rows, cursor) as T;
  }

  // ── Invoices ────────────────────────────────────────────────────────────────
  if (url === '/invoices' && method === 'GET') {
    const status = query.get('status') ?? '';
    const bucket = query.get('agingBucket') ?? '';
    let rows: InvoiceSummary[] = [...DEMO_INVOICES];
    if (status) rows = rows.filter((i) => i.status === status);
    if (bucket) rows = rows.filter((i) => i.status === 'overdue' || i.status === 'partially_paid');
    return paginate(rows, cursor) as T;
  }

  if (method === 'PATCH' && /^\/invoices\/[^/]+\/mark-paid$/.test(url)) {
    const id = segment(url, 1);
    const found = DEMO_INVOICES.find((i) => i.id === id);
    return {
      id,
      status: 'paid' as InvoiceStatus,
      amountPaid: found?.total ?? '0.00',
    } as T;
  }

  if (method === 'PATCH' && /^\/invoices\/[^/]+\/void$/.test(url)) {
    const id = segment(url, 1);
    return { id, status: 'void' as InvoiceStatus } as T;
  }

  if (method === 'POST' && /^\/invoices\/[^/]+\/resend$/.test(url)) {
    return { sent: true } as T;
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

  return notFound(`${method} ${url}`);
}

/** Flip a buyer's approval status on both the summary row and the detail row. */
function setBuyerStatus(buyerId: string, status: string): void {
  const detail = DEMO_BUYER_DETAILS[buyerId];
  if (detail) detail.approvalStatus = status;
  const summary = DEMO_BUYERS.find((b) => b.buyerId === buyerId);
  if (summary) summary.approvalStatus = status;
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
