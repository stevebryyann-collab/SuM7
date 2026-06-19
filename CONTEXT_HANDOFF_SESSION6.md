# CONTEXT_HANDOFF_SESSION6.md — CONSOLIDATED CONTINUATION HANDOFF

_Generated: 2026-06-16 (Session 6). **This is the authoritative READ-FIRST handoff.**_

> **Why this file exists:** Session 6 began a NEW phase — making the app match a detailed
> **COMPLETE USER JOURNEY** spec (every screen / button / state) — and then hit a context reset.
> This document consolidates everything a fresh Claude needs to continue with minimal
> re-discovery. It **supersedes** the prior handoffs for *current state*, but removes nothing:
>
> - `CONTEXT_HANDOFF_FINAL_UPDATED.md` — Session 5 (Prompt-5 close-out + install-repair). **History.**
> - `CONTEXT_HANDOFF_FINAL.md` — Sessions 1–3 (API build + web bootstrap). **History.**
> - `CONTEXT_HANDOFF.md` — earliest. **History.**
> - `/root/.claude/plans/polished-coalescing-tarjan.md` — the full journey gap-analysis + 4-group
>   plan authored Session 6 (embedded in §4–§5 below; read it for the per-chapter checklist).
>
> Everything those files assert about the **original Prompts 1–5 build remains valid.** This file
> adds the journey-parity phase on top.

---

## 0. SESSION 6 TL;DR

- The repo **compiles clean**: `pnpm typecheck` → **6/6 tasks, exit 0**, verified THIS session.
  No repo files changed since that run, so the green state is preserved. (Bash classifier then went
  intermittently unavailable — re-run typecheck at next session start to reconfirm.)
- The **API is largely complete** (Prompts 1–4 committed + Session-4 gap fixes uncommitted).
- The **web frontend is a real-but-thin v1**: every existing page is wired to live API hooks,
  follows the design system, and has loading/empty states — but **~15 journey screens are missing**
  and many interactions are simplified.
- Session 6 produced a **gap analysis** (DONE/PARTIAL/MISSING per journey chapter) and an
  **approved 4-group implementation strategy** (§4–§5). **No journey code has been written yet** —
  the next session starts Group 1.
- **Nothing is committed** beyond `53fc4ad`. All of Prompt 5 + Session-4 API fixes are uncommitted.

---

## 1. PROJECT OVERVIEW

**Product.** A financial-grade, Shopify-embedded **B2B Wholesale operating-system SaaS**. Merchants
get: unlimited pricing tiers, spreadsheet-style bulk ordering, self-serve buyer onboarding, automated
PDF invoicing, accounts receivable, and BNPL (via Resolve). Launch vertical: Fashion & Apparel.

**Architecture.** Turborepo pnpm monorepo. **Frontend** = Next.js 14 App Router on Vercel.
**Backend** = NestJS 10 REST + GraphQL on Railway. **DB** = Supabase PostgreSQL 16 (+ PgBouncer).
Two Redis instances (cache 6379 LRU; queue 6380 AOF, BullMQ). All money is `Decimal.js`
(`ROUND_HALF_EVEN`). All financial writes are `$transaction({ isolationLevel: 'Serializable' })`.
All external calls go through `opossum` circuit breakers. Pagination is cursor-only. Multi-tenancy is
TWO layers: app-level `where:{merchantId}` **and** Postgres Row-Level Security (both always on).

**Monorepo structure** (package scope is **`@b2b/*`**, NOT `@wholesale-portal/*` despite CLAUDE.md prose):
```
apps/web    (@b2b/web)      Next.js 14 — merchant admin + buyer portal
apps/api    (@b2b/api)      NestJS 10 — REST + GraphQL
packages/shared    (@b2b/shared)     TS types, Zod schemas, utils, error codes
packages/database  (@b2b/database)   Prisma schema, migrations, generated client
tests/{e2e,load}   Playwright + k6
docs/runbooks      runbooks + deployment checklist
```

**Authentication architecture (SPLIT — never mix).**
- **Merchant** = NextAuth v4 + Shopify OAuth (PKCE). The jwt callback mints an **HS256 token signed
  with `NEXTAUTH_SECRET`** (NOT default NextAuth JWE), surfaced as `session.accessToken`; the API's
  `MerchantSessionGuard` verifies exactly that. Shopify embedded-app requirement — Clerk cannot verify
  Shopify session tokens.
- **Buyer** = Clerk entirely (sessions, brute-force, password, token rotation). Buyers have no Shopify
  identity. API guards: `ClerkBuyerGuard` (approved buyer routes), `ClerkAuthenticatedGuard`
  (pre-approval `apply` route).
- Clerk `<ClerkProvider>` is scoped to `(auth)/(buyer-auth)/` + `(buyer)/` ONLY — wrapping the merchant
  tree crashes `/merchant-login` with "Missing publishableKey".

**Billing architecture.** Stripe hybrid: flat subscription (Starter/Growth/Pro) + **metered GMV** with
per-tier free thresholds. `BillingService` writes Stripe usage records, SHA-256 idempotency keys,
dunning, and caches `merchant:tier:*`. Webhook handles subscription lifecycle.

**Database architecture.** Supabase PG16. `DATABASE_URL` = pooler (PgBouncer, 6543, runtime);
`DATABASE_DIRECT_URL` = direct (5432, migrations). RLS roles `app_user`/`audit_writer`. 13 tables
(merchants, merchant_users, buyers, merchant_buyer_relationships, pricing_tiers,
pricing_tier_overrides, orders, order_line_items, invoices, buyer_registration_applications,
webhook_events, idempotency_keys, audit_log). `invoice_number_seq`; GIN trigram index on
`buyers.company_name`; audit-log immutability trigger.

**Deployment assumptions.** Vercel (web, `output:'standalone'`, CSP whitelisting Clerk, HSTS,
X-Frame DENY), Railway (API + both Redis), Supabase (DB). **No live DB in this dev environment** — all
DB/RLS work is typecheck-only; migrations authored, not applied. `.npmrc` → `registry.npmmirror.com`
(default registry unreachable here).

---

## 2. CURRENT REPOSITORY STATE

- **Branch:** `main` @ **`53fc4ad`** ("Prompt 4: buyer/merchant APIs, secure GraphQL, BNPL (Resolve),
  Stripe billing").
- **Recent commits:**
  ```
  53fc4ad Prompt 4: buyer/merchant APIs, secure GraphQL, BNPL (Resolve), Stripe billing
  d960cb4 Merge remote-tracking branch 'origin/main'
  3846c3d Prompt 3: orders + invoices controllers/services; revert merchant auth to NextAuth
  9354bdd Prompt 2 complete - Clerk migration, webhooks, queues, workers, catalog, pricing
  14e3017 initial-state-before-clerk-migration
  753abf8 initial commit
  ```
- **Build status:** API `nest build` green (Session 5); web `next build` green (16/16 pages, Session 5,
  with a realistic env block — see §7 gotcha #2).
- **Typecheck status:** **GREEN, 6/6, exit 0** — re-verified Session 6; unchanged since.
- **Working tree (uncommitted — Prompt 5 + Session-4 API fixes):**
  ```
   M .claude/settings.local.json   M .env.example   M README.md
   M CONTEXT_HANDOFF_FINAL.md
   M apps/api/package.json
   M apps/api/src/buyers/buyers.controller.ts      M apps/api/src/buyers/buyers.service.ts
   M apps/api/src/catalog/catalog.module.ts
   M apps/api/src/invoices/invoices.controller.ts  M apps/api/src/invoices/invoices.service.ts
   M apps/api/src/pricing/pricing.service.ts
   M apps/web/next-env.d.ts   M apps/web/next.config.mjs   M apps/web/package.json
   M package.json   M pnpm-lock.yaml
  ?? .github/workflows/   ?? .lighthouse-budget.json   ?? .lighthouserc.json
  ?? CONTEXT_HANDOFF_FINAL_UPDATED.md
  ?? apps/api/.eslintrc.cjs   ?? apps/api/src/catalog/catalog.controller.ts
  ?? apps/web/.eslintrc.json  ?? apps/web/postcss.config.mjs   ?? apps/web/src/
  ?? apps/web/tailwind.config.ts   ?? apps/web/vercel.json
  ?? docs/   ?? playwright.config.ts   ?? tests/
  ```
  (Session 6 also created `/root/.claude/plans/polished-coalescing-tarjan.md` — outside the repo — and
  this file. No application code changed in Session 6.)

- **Known issues:** see §7. Most important: large uncommitted surface (loss risk → consider a checkpoint
  commit); no live DB; install-symlink trap; PII currently shipped in some list payloads (security fix
  scheduled in Group 1).

- **Existing demo-mode implementation:** `apps/web/src/lib/dev/` — `demo.ts` (production gate:
  `isDemoEnabled()` / `isDemoMerchantId()`), `mock-api.ts` (`mockMerchantRequest` + `mockMerchantGraphQL`),
  `mock-data.ts` (fixtures). `merchantFetch` transparently routes to the mock when a demo session is
  active, so the **merchant admin renders with NO backend running**. Currently covers a SUBSET of routes
  (buyers list/applications, approve/reject/suspend, orders list, invoices list/mark-paid/void/resend,
  pricing-tiers list, dashboard + ar-aging GraphQL). **Buyer-side demo path not yet built.** Per the user
  decision (§6), every NEW screen must work in BOTH demo mode and real-backend mode → mock fixtures must
  be extended alongside each new feature.

---

## 3. COMPLETED WORK (cumulative, Prompts 1–5)

### Backend API (`apps/api`) — Prompts 1–4 committed; Session-4 gaps uncommitted
**Implemented routes (verified by reading controllers):**
- **Pricing** (`api/v1/pricing-tiers`): GET list, POST create, GET :id, PATCH :id, DELETE :id,
  POST :id/overrides/bulk, DELETE :id/overrides/:overrideId. `PricingService` is Decimal.js-based
  (pricing unit tests 19/19 per handoffs).
- **Buyers**: POST buyer/apply, GET buyers, GET buyers/applications, POST buyers/applications/:id/approve,
  POST buyers/applications/:id/reject, POST buyers/:buyerId/suspend. GDPR export/erase via analytics
  controller (`data-export/gdpr/:buyerId` GET + DELETE; Clerk `users.deleteUser`).
- **Orders**: POST buyer/orders (Serializable persist w/ 40001 retry, credit FOR-SHARE + optimistic CAS,
  Shopify draft create→complete with delete-compensation + credit-release, idempotency via global
  middleware), GET buyer/orders, GET buyer/orders/:id, GET orders, GET orders/:id (`getOrderDetail`).
- **Invoices**: GET invoices (status/buyerId/agingBucket), GET invoices/ar-aging (single CTE, 5 buckets),
  GET invoices/:id/integrity, PATCH invoices/:id/mark-paid (FOR UPDATE + GMV rollover + credit decrement),
  PATCH invoices/:id/void, POST invoices/:id/resend (Redis-rate-limited `invoice:resend:{id}`),
  GET buyer/invoices, GET buyer/invoices/:id/download (presigned, ownership-checked). `@Roles('owner',
  'admin')` on mutating merchant routes.
- **Catalog**: GET buyer/catalog (cursor + search, tier pricing applied).
- **Analytics** (`api/v1`): summary, ar-aging, buyers/top, orders/trend, gmv/monthly.
- **Billing** (`api/v1/billing`): POST subscribe, POST change-tier, GET portal, GET usage, POST webhook.
- **BNPL** (`api/v1`): POST buyer/bnpl/eligibility, POST buyer/bnpl/initiate, POST bnpl/resolve/webhook
  (ResolveAdapter behind `resolve` opossum breaker, 5xx retry, HMAC `timingSafeEqual`).
- **Merchants**: POST internal/merchants/upsert (INTERNAL_API_SECRET; encrypts Shopify token at rest).
- **GraphQL** (`/graphql`): dashboard (CTE), ar-aging, buyers (Relay connection) resolvers; depth-limit 8,
  complexity 200, APQ via Redis cache, CSRF, prod error masking; auth verified in
  `GraphqlContextService` (no shared GraphQL guard).
- **Webhooks**: 8 Shopify topics (orders created/updated/paid; products created/updated/deleted;
  customers/create; app/uninstalled) behind `WebhookHmacGuard` (HMAC + timestamp replay + domain check);
  Clerk `webhooks/clerk` (Svix-verified; user.created/updated/deleted); Stripe `billing/webhook`
  (`@SkipThrottle`, sig verified inside); Resolve `bnpl/resolve/webhook` (HMAC inside).

**Guards/security:** MerchantSessionGuard (HS256/`NEXTAUTH_SECRET`; codes MISSING_TOKEN/INVALID_TOKEN/
MERCHANT_INACTIVE), ClerkBuyerGuard (approval check, NO_RELATIONSHIP/BUYER_SUSPENDED/BUYER_NOT_APPROVED/
ACCOUNT_ERASED), ClerkAuthenticatedGuard, RolesGuard + `@Roles`, internal-secret.guard. RateLimitGuard
(per-IP + per-tier; exempts `/webhooks` via regex). IdempotencyMiddleware on POST/PATCH. EncryptionService
(AES-256-GCM, key versioning) for taxId/phone at rest.

**Background jobs (BullMQ, 5 queues / 7 workers):** buyer-sync, catalog-sync, invoice-generate,
invoice-mark-paid, merchant-cleanup, merchant-purge-data, order-sync. Multi-job queues use ONE WorkerHost
dispatching by job name (never a second `@Processor` on the same queue).

**Infra:** PrismaService (RLS middleware, statement_timeout, slow-query log), MerchantContextService
(AsyncLocalStorage), RedisModule (cache+queue tokens), CircuitBreakerFactory (opossum named breakers),
ShopifyApiService (rate-limit aware, breaker-wrapped), correlation middleware + OpenTelemetry, health
(live/ready), queue-health, circuit-breakers health, bull-board.

**Emails (5 templates, inline HTML — `@react-email/components` NOT installed):** invoice,
payment-reminder (tone 1/2/3), buyer-approval, buyer-rejection, merchant-new-application.
`EmailService` = 8 non-throwing methods returning `{sent, messageId?}` via the `resend` breaker.

### Frontend (`apps/web/src`) — Prompt 5, uncommitted
Next.js 14 App Router; Tailwind design system (shadow-only skeuomorphism per CLAUDE.md). NextAuth (merchant,
`buildAuthOptions()` factory, per-request secret reads) + Clerk (buyer) wiring. API client layer
(`core.apiRequest` Bearer-only; `merchantFetch` + demo fallback; `buyerFetch` + Clerk token bridge;
`merchantGraphQL`). UI primitives, shared components, providers, feature components, TanStack hooks (all
listed in §0 of `CONTEXT_HANDOFF_FINAL.md`). **Existing pages:** merchant `dashboard / buyers / pricing /
orders / invoices`; buyer `portal/{catalog,orders,invoices,apply}`; auth `merchant-login / buyer-login /
buyer-signup`; `api/auth/[...nextauth]`. Edge `middleware.ts`: App-Proxy HMAC → `__merchant_domain`/
`__merchant_id` cookies; merchant gating via `getToken`; buyer gating via Clerk cookie presence.

### Shared / Database
- `@b2b/shared/types`: ApprovalStatus, InvoiceStatus (incl. `'defaulted'`), PaymentTerms, PricingTierType,
  PaginatedResponse, etc. `@b2b/shared/schemas`: BuyerLogin, BuyerRegisterApplication, UpsertMerchant,
  CreatePricingTier (volume-bracket `superRefine`), UpdatePricingTier, PricingOverride,
  BulkPricingOverride, BillingTier, BulkOrder, ApproveBuyer, RejectBuyer, MarkPaid, CursorPagination.
  **Barrel `@b2b/shared` is server-poisoned** (`node:async_hooks`/`node:crypto`) → web imports
  `@b2b/shared/types` + `@b2b/shared/schemas` subpaths ONLY.
- `@b2b/database`: Prisma 5, 13-table schema; migrations incl. `003_rls.sql`,
  `004_drop_merchant_clerk_org_id.sql`, `005_invoice_status_defaulted.sql`.

### Infra / tests / docs (present; CI-only execution)
`vercel.json`, `next.config.mjs` (rewrite `/apps/wholesale/:path* → /portal/:path*`),
`.github/workflows/ci.yml` (8 jobs) + dependabot, `.lighthouse*.json`, `tests/load/*.k6.js`,
`playwright.config.ts` + `tests/e2e/*`, README, `docs/runbooks/{secrets-rotation,disaster-recovery}.md`,
`docs/deployment-checklist.md`. Playwright/k6 **never executed** (no browsers/k6 binary here).

---

## 4. JOURNEY GAP ANALYSIS (vs the COMPLETE USER JOURNEY spec)

Categories preserved exactly: **DONE / PARTIAL / MISSING**. Full per-chapter detail with the exact
requirement for each item lives in `/root/.claude/plans/polished-coalescing-tarjan.md`.

### Merchant journey
| Ch | Area | Status | Gap summary |
|----|------|--------|-------------|
| 1 | Install / OAuth | **DONE** | NextAuth Shopify + upsert. |
| 2 | Empty-state dashboard | **PARTIAL** | Missing welcome banner, empty illustration, Get-Started checklist, trial banner. |
| 3 | Pricing | **PARTIAL** | Read-only table only. Missing Create/Edit modal (3 types + volume-bracket builder), tier cards (Edit/View buyers/Manage overrides/Delete + guard), `/pricing/[id]` overrides (CSV import preview, add/delete). |
| 4 | Buyers | **PARTIAL** | Missing tabs+counts, filter bar, Copy-link, Reinstate, View(read-only), row-click, Notes, approved inline-edit; PII reveal needs confirm + audit. |
| 5 | Orders (merchant) | **PARTIAL** | List only. Missing filters, Sync-Status badges, `/orders/[id]` detail. |
| 6 | Invoices (merchant) | **PARTIAL** | Missing tabs, summary bar, Void, Mark-Paid form, `/invoices/[id]` detail, `/invoices/ar-aging` report. |
| 7 | Analytics | **MISSING** | No `/analytics` page (REST endpoints exist). |
| 8 | Settings | **MISSING** | No `/settings`, `/settings/billing`, `/settings/team` (billing API exists; settings/team API missing). |
| 9 | Dashboard (full) | **PARTIAL** | Missing Recent Invoices, Pending Applications panel, avatar dropdown; sidebar missing Analytics+Settings. |

### Buyer journey
| Ch | Area | Status | Gap summary |
|----|------|--------|-------------|
| 10 | Apply / register | **PARTIAL** | Login/signup DONE. Apply: needs selects, char count, error mapping (409/429/422), dedicated `/apply/success`. |
| 11 | Approval notifications | **PARTIAL** | Approval/rejection emails DONE. Missing buyer pending-status card. |
| 12 | Catalog / ordering | **PARTIAL** | Biggest. Missing welcome bar, %-off badge+tooltip, volume-break popover (live price), search highlight + "N of M", CSV preview modal, Reorder, Matrix view, minimum-order gating, full Review-Order modal (credit usage, success + error states). |
| 13 | BNPL (frontend) | **MISSING** | API exists; no UI in Review modal. |
| 14 | Buyer orders | **PARTIAL** | List only; missing filter + `/portal/orders/[id]`. |
| 15 | Buyer invoices | **PARTIAL** | List+download; missing filter, `/portal/invoices/[id]`, overdue banner, partial balance. |
| 16 | Buyer account | **MISSING** | No `/portal/account` (needs `GET /buyer/me`). |
| 17 | Error states | **PARTIAL** | Missing offline banner, session-expired msg, 402 subscription/trial gate, 403 buyer-suspended page, outage/PDF-timeout copy. |
| 18 | Loading/empty | **DONE** (mostly) | Add a few filtered-empty friendly states. |
| 19 | Emails | **PARTIAL** | Missing app-received, invoice-voided, BNPL confirmed/defaulted, payment-received, subscription failed/suspended. |
| 20 | Toasts | **DONE** | sonner in use; fill copy as screens land. |

### Backend endpoints to ADD (only what the journey needs)
`GET /invoices/:id` + `GET /buyer/invoices/:id` (detail); `POST /buyers/:buyerId/reinstate`;
`PATCH /buyers/:buyerId` (tier/terms/credit); `GET /buyers/:buyerId`; PII-reveal endpoint
(decrypt taxId/phone on demand + audit; stop shipping plaintext in list payloads); `GET /buyer/me`;
merchant settings GET+PATCH; team list/role/remove (+ invite stub). All: correct guard, Zod-validated,
audit-logged on mutation, cursor pagination on lists.

---

## 5. APPROVED IMPLEMENTATION STRATEGY — FOUR GROUPS

Ordered by priority then ascending difficulty. Each is a coherent vertical slice that keeps
`pnpm typecheck` green. Execute **sequentially**, typecheck after each, then (where pricing/financial
touched) pricing unit tests, then a web build. Within a group: backend endpoint → shared Zod schema →
demo-mock fixtures → frontend wiring. **Verify in BOTH demo mode and real-backend mode** (user decision).

### GROUP 1 — Merchant Core Admin + App Shell  *(highest priority, medium)*
**Objectives:** the merchant first-run path — navigate, set up pricing, approve/manage buyers, real dashboard.
- **Frontend:** sidebar + Analytics/Settings items + avatar dropdown (`MerchantNav`, new `MerchantTopbar`);
  dashboard welcome/empty-state + Get-Started checklist + trial banner + Recent Invoices + Pending
  Applications; pricing empty-state + `PricingTierModal` (create+edit, 3 types, volume-bracket builder w/
  validation, default checkbox) + tier cards (Edit/View buyers/Manage overrides/Delete + buyer-count guard)
  + `/pricing/[id]` overrides (CSV preview modal, add/delete); buyers tabs+counts + filter bar + Copy-link +
  Reinstate + View + row-click + Notes + approved inline-edit; PII reveal → confirm + audit.
- **Backend:** `POST /buyers/:buyerId/reinstate`, `PATCH /buyers/:buyerId`, `GET /buyers/:buyerId`,
  PII-reveal endpoint. (Pricing CRUD already exists — reuse.)
- **Mock/demo:** pricing create/update/delete + overrides; buyer reinstate/update/detail/reveal fixtures.
- **Affected files:** `components/merchant/{MerchantNav,MerchantTopbar,PricingTierModal,OverrideImport*,
  BuyerApprovalPanel,PiiField}.tsx`, `app/(merchant)/{dashboard,pricing,pricing/[id],buyers}/page.tsx`,
  hooks `usePricingTiers/useBuyers`, `lib/api/merchant.ts`, API `pricing`/`buyers`, `lib/dev/mock-*.ts`.
- **Verify:** typecheck 6/6; pricing unit tests; demo click-through of every new button.

### GROUP 2 — Orders & Invoices Depth  *(high priority, medium)*
**Objectives:** detail pages + invoice operations.
- **Frontend:** orders filters + Sync-Status badges; `/orders/[id]` (merchant) + `/portal/orders/[id]`
  (buyer); invoices tabs + filter + summary bar; Void + Mark-Paid form; `/invoices/[id]` (merchant: PDF
  preview, status timeline, Download+integrity, Resend count, payment history, audit trail);
  `/portal/invoices/[id]` (buyer + overdue banner + partial balance); `/invoices/ar-aging` (cards, chart,
  table, Export CSV).
- **Backend:** `GET /invoices/:id`, `GET /buyer/invoices/:id`.
- **Mock/demo:** order/invoice detail, void, ar-aging fixtures.
- **Affected files:** `app/(merchant)/orders/[id]`, `invoices/[id]`, `invoices/ar-aging`;
  `app/(buyer)/portal/orders/[id]`, `portal/invoices/[id]`; `components/merchant/{OrderDetail,
  InvoiceDetail,InvoiceTimeline}.tsx`; hooks `useOrders/useInvoices/useInvoiceActions`; API `orders`/`invoices`.
- **Verify:** typecheck; financial paths → pricing tests; demo click-through.

### GROUP 3 — Buyer Ordering Experience + Account  *(high priority, high)*
**Objectives:** the spreadsheet ordering core + BNPL + apply polish + account.
- **Frontend:** `BulkOrderTable` welcome bar, %-off badge+tooltip, volume-break popover (live price),
  client search highlight + "N of M", CSV preview modal, Reorder last order, Matrix view, minimum-order
  gating, full Review-Order modal (items/terms/dates/credit usage, success + MINIMUM_ORDER_NOT_MET /
  CREDIT_LIMIT_EXCEEDED / generic-retry; one idempotency key per modal-open); BNPL section (eligibility →
  terms → Resolve redirect); apply selects + char count + error mapping + `/apply/success` + pending card;
  `/portal/account` (credit-used bar + Clerk manage).
- **Backend:** `GET /buyer/me`; reuse `GET /buyer/orders/:id` for Reorder.
- **Mock/demo:** catalog tiers (pct + volume), bnpl eligibility/initiate, buyer me/order/invoice detail.
- **Affected files:** `components/buyer/{BulkOrderTable,ReviewOrderModal,CsvPreviewModal,
  VolumeBreakPopover,MatrixView,BnplSection,BuyerNav}.tsx`; `app/(buyer)/portal/{apply,apply/success,
  account}/page.tsx`; hooks `useBuyerCatalog/useCreateOrder/useBnpl/useBuyerAccount`; API `bnpl`/`buyers`.
- **Verify:** typecheck; demo + (if backend) real order placement smoke.

### GROUP 4 — Analytics + Settings + Billing + Team + Error States  *(medium priority, varied)*
**Objectives:** reporting, configuration, billing UI, platform-wide error gates, remaining emails.
- **Frontend:** `/analytics` (presets, KPIs, charts, top buyers, monthly GMV, export); `/settings`
  (general/invoice/notifications); `/settings/billing` (plan card, usage bar, comparison, Change-plan
  modal, Stripe portal); `/settings/team` (list, invite "coming soon", role, remove); error gates
  (402 subscription/trial full-page gate, 403 buyer-suspended, offline banner, session-expired,
  PDF-timeout/Shopify-outage copy).
- **Backend:** merchant settings GET/PATCH; team list/role/remove (+ invite stub). Emails: app-received,
  invoice-voided, BNPL confirmed/defaulted, payment-received, subscription failed/suspended.
- **Mock/demo:** analytics, settings, team, billing usage fixtures.
- **Affected files:** `app/(merchant)/{analytics,settings,settings/billing,settings/team}/page.tsx`;
  `components/merchant/{PlanComparison,ChangePlanModal,UsageBar}.tsx`;
  `components/shared/{OfflineBanner,SubscriptionGate}.tsx`; API `merchants` (settings/team) +
  `email/templates/*`.
- **Verify:** typecheck; web build; demo click-through.

**Non-goals:** team invite is a v1 "coming soon" stub (per spec); keep existing routes (`/merchant-login`,
`/portal/*`) — the spec's bare URLs map onto them; no unrelated refactors.

---

## 6. USER INTENT (explicit — honor in every group)

- **Enterprise-grade, production-ready, scalable.** No shortcuts. No placeholder logic.
- **No dead buttons. No broken navigation. No regressions.** Every button on every new screen must do
  something real (and must work in **both** demo mode and real-backend mode).
- **Preserve existing working functionality** — do not break what compiles/works today.
- **Maintain security standards** (auth separation, RLS, role gating, PII handling, HMAC verification).
- **Maintain type safety** (TS strict, zero `any` in business logic).
- **Maintain audit logging** on every financial/account state change.
- **Maintain financial integrity** (Decimal.js, Serializable txns).
- **Keep builds green after every phase** (`pnpm typecheck` 0 errors is the floor).
- **Behave exactly like the COMPLETE USER JOURNEY spec** — every screen, button, and state.

---

## 7. ENGINEERING STANDARDS & GOTCHAS (preserve all)

**Architectural constraints (CLAUDE.md, non-negotiable):** Decimal.js for money / no float math;
Serializable transactions for financial writes; audit log on every financial state change; opossum
circuit breakers on all external calls; cursor pagination only; NextAuth(merchant)/Clerk(buyer)
separation; existing design system (minimalism + shadow-only press states, single accent, solid badges,
no gradients/blur/translate, ≤2 font weights, ≤3 type sizes/view); existing route structure
(`/merchant-login`, buyer under `/portal/*`); webhook signature verification before any processing.

**Environment / build gotchas:**
1. **Broken web symlinks:** if web typecheck/build dies with `TS2307 Cannot find module 'next-auth'`
   (etc.), run `rm -rf apps/web/node_modules && pnpm install --offline` (`pnpm install` alone says
   "up to date" and won't relink).
2. **`NEXTAUTH_SECRET` must be real base64** (`openssl rand -base64 32`) for `next build` to pass page-data
   collection on `/merchant-login`; it must **match web ↔ API** (the API guard verifies the same secret).
3. **`@b2b/shared` barrel is server-poisoned** — web imports `@b2b/shared/types` + `@b2b/shared/schemas`
   subpaths only.
4. **Buyer pages under `/portal/*`** (route-group collision otherwise); App-Proxy rewrite is
   `/apps/wholesale/:path* → /portal/:path*`.
5. **NextAuth options via `buildAuthOptions()` factory** (per-request secret reads, never module-load).
6. **Clerk provider scoped to buyer tree only** (never wrap merchant routes).
7. **Package scope is `@b2b/*`** (not `@wholesale-portal/*`).
8. **Error codes** are inline snake_case string literals (no constants file, despite CLAUDE.md).
9. **`.npmrc` → `registry.npmmirror.com`** (default registry unreachable here) — keep for installs.
10. **No live DB** — DB/RLS verification is typecheck-only; apply migrations + `003_rls.sql` on real
    Supabase before deploy.
11. **`@react-email/components` NOT installed** — email templates are inline HTML (swap later behind
    `RenderedEmail`).
12. **Bash safety classifier has intermittent outages** in this env — read-only tools always work; retry
    Bash, or proceed with file ops and re-verify later.
13. **Demo mode** is the only runtime path without a backend — keep mock fixtures in lockstep with new
    endpoints (identical DTO envelopes so pages/hooks stay unmodified).
14. **RateLimitGuard** exempts only `/webhooks` (regex); BNPL/Stripe webhook paths still hit per-IP tier
    unless `@SkipThrottle()` (Stripe has it).
15. **Multi-job BullMQ queues** use ONE WorkerHost dispatching by job name — never a second `@Processor`.

---

## 8. IMMEDIATE NEXT ACTION

### A. Current repo status
Branch `main` @ `53fc4ad`. Prompts 1–4 committed; Prompt 5 (web + infra + docs) and Session-4 API gap
fixes **uncommitted** (~30 paths). `pnpm typecheck` **green 6/6** (verified Session 6; unchanged since).
API + web builds were green in Session 5. No journey code written yet.

### B. What remains
- **Track A — original build close-out (pre-existing):** commit Prompt 5; run Playwright + k6 in CI;
  apply migrations 003_rls/004/005 on a live DB; decide deferred CLAUDE.md schema reshaping (buyers
  `passwordHash`/`loginFailCount`/`lockedUntil` removal; `merchant_users` password/mfa restore) — confirm
  with user first (cascades into `seed.ts` + `merchants.service.ts`).
- **Track B — user-journey parity (active forward plan):** the 4 groups in §5 — ~15 missing screens,
  ~8 new backend endpoints, demo-fixture extensions, remaining emails, error gates.

### C. Recommended next implementation step
1. Re-run `pnpm typecheck` to reconfirm the green floor (Bash may be flaky — retry).
2. **Strongly consider a checkpoint commit** of the current green state on a new branch before journey
   work (the uncommitted surface is large; commit only if the user approves, per repo convention).
3. **Begin Group 1** (Merchant Core Admin + App Shell), starting with the backend buyer endpoints
   (reinstate / update / detail / PII-reveal) + their Zod schemas, then demo fixtures, then the frontend.

### D. Estimated implementation order
Group 1 → Group 2 → Group 3 → Group 4. Within each: backend route → shared schema → demo mock → frontend
→ typecheck (+ pricing tests if financial) → demo click-through. Keep the build green at every boundary.

### E. Risks & dependencies
- **No live DB** → demo mode is the only local runtime verification; real-backend verification deferred to
  an env with Supabase/Redis/API running.
- **Security debt to fix in Group 1:** PII (taxId/phone) is currently present in some list payloads — the
  reveal flow must move to an on-demand, audited, decrypt endpoint; role-gate Void/Team/Settings
  (owner/admin) via RolesGuard.
- **Large uncommitted surface** → risk of loss; checkpoint commit recommended.
- **Install-symlink + `NEXTAUTH_SECRET` traps** (§7 #1–2) will bite a fresh clone/build.
- **Auth separation** must be preserved (no Clerk in merchant tree; no NextAuth for buyers).
- **Barrel subpath imports** must be preserved on every new web file.
- **Bash classifier flakiness** can block verification commands — retry; do not interpret an outage as a
  failing build.

---

_End of consolidated handoff. For per-chapter requirement detail, read
`/root/.claude/plans/polished-coalescing-tarjan.md`. For historical session narratives, read the prior
`CONTEXT_HANDOFF_*` files (superseded for current state by this document)._
