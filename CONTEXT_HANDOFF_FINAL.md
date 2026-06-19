# CONTEXT_HANDOFF_FINAL.md

_Generated: 2026-06-15. Updated: 2026-06-16 (Session 3). Single source of truth for resuming this project in a brand-new session._

> **READ FIRST (Session 3 update):** Session 3 began **Prompt 5 — the web frontend** (`apps/web`).
> The entire `apps/web/src` tree was bootstrapped from empty: Tailwind + design system, the API
> client layer, NextAuth (merchant) + Clerk (buyer) auth wiring, all shared/UI/feature components,
> all TanStack Query hooks, every merchant + buyer + auth page, and the edge middleware. **TypeScript
> typecheck passes (`tsc --noEmit`, exit 0)** and **webpack compiles successfully**, but the
> production build currently **fails during "Collecting page data" on `/merchant-login`** (a NextAuth
> `atob` decode error — see SESSION 3 → KNOWN ISSUES). Prompt 5 is **NOT finished**: Tasks 11–16
> (vercel/next config, CI/CD, k6, Playwright, build config, runbooks/README) are **not started**.
> See **SESSION 3** immediately below for the authoritative current state. Sessions 1–2 (the API)
> remain valid and are retained below for history.
>
> Verified Session 3:
> - `pnpm --filter @b2b/web typecheck` (`tsc --noEmit`) → **exit 0, clean**
> - `pnpm --filter @b2b/web build` → **compiles ✓ but FAILS at page-data collection** (see Known Issues)
> - Sessions 1–2 API verifications still hold (see SESSION 2 below).

---

## SESSION 3 — IN PROGRESS (Prompt 5: web frontend / `apps/web`)

**Goal:** implement Prompt 5 — the complete Next.js 14 App Router frontend (merchant admin +
buyer portal), shared/UI components, TanStack Query hooks, auth pages, plus the CI/CD, load
tests, Playwright suite, build config and runbooks. **Frontend application code is largely done;
the surrounding infra/test/doc tasks are not started.**

### What was DONE this session (all files under `apps/web/`)

**Dependencies** — rewrote `apps/web/package.json` with the full locked stack and ran
`pnpm install` (succeeded via the `registry.npmmirror.com` mirror in `.npmrc`). Added: `@clerk/nextjs@5.7.5`,
`@tanstack/react-query@5.59.0`, `@tanstack/react-virtual@3.10.8`, `recharts@2.12.7`,
`react-hook-form@7.53.0` + `@hookform/resolvers@3.9.0`, `zustand@4.5.5`, `date-fns@3.6.0`,
`lucide-react@0.446.0`, `graphql@16.9.0` + `graphql-request@7.1.0`, `sonner@1.5.0`,
`class-variance-authority`/`clsx`/`tailwind-merge`/`tailwindcss-animate`, Radix primitives
(`react-dialog`, `react-alert-dialog`, `react-tabs`, `react-select`, `react-slot`, `react-label`),
and devDeps `tailwindcss@3.4.13`/`postcss`/`autoprefixer`/`eslint`/`eslint-config-next`.

**Tooling / design system**
- `apps/web/tailwind.config.ts` — single accent color (blue `#2563eb`), `accent`/`border`/`panel`/`muted`
  tokens, `text-label` (11px), 100ms-max animations, `tailwindcss-animate` plugin.
- `apps/web/postcss.config.mjs`
- `apps/web/src/app/globals.css` — base styles + `.btn-base`/`.btn-primary`/`.btn-destructive`/`.input-base`/`.panel`
  utility classes implementing the CLAUDE.md skeuomorphic (shadow-only, no-transform) rules.

**Lib layer (`apps/web/src/lib/`)**
- `cn.ts` (clsx+tailwind-merge), `env.ts` (non-throwing public-env reader — warns in dev, never
  throws at build), `format.ts` (money/date/percent formatters — money stays string-based),
  `query-client.ts` (TanStack defaults; never retries 4xx).
- `api/core.ts` (the single `apiRequest` fetch primitive; Bearer-only, no cookies, parses the API
  `{code,message,errors}` envelope into a typed `ApiClientError`), `api/error.ts`,
  `api/merchant.ts` (`merchantFetch` — attaches NextAuth `session.accessToken`),
  `api/buyer.ts` (`buyerFetch` — Clerk token via a registerable getter bridge),
  `api/graphql.ts` (`merchantGraphQL` via graphql-request to `/graphql`).
- `auth/shopify-provider.ts` (NextAuth v4 Shopify OAuth+PKCE provider) and
  `auth/auth-options.ts` (signIn → calls `POST /internal/merchants/upsert` with `X-Internal-Secret`;
  jwt callback **signs an HS256 token with `NEXTAUTH_SECRET`** carrying
  `merchantId/merchantUserId/shopifyDomain/role/email` — exactly what the API's
  `MerchantSessionGuard` verifies — on a 7-day sliding window; session exposes it as `accessToken`).

**Types** — `src/types/api.ts` (frontend mirrors of API response DTOs: dashboard, AR aging,
buyers, applications, pricing tiers, orders, invoices, catalog) and `src/types/next-auth.d.ts`
(module augmentation: `session.accessToken/merchantId/shopifyDomain/role`).

**UI primitives (`src/components/ui/`)** — `button`, `input`, `textarea`, `label`, `spinner`,
`tabs`, `select`, `sheet` (right slide-over), `alert-dialog`, `table` (all Radix-based, design-system styled).

**Shared components (`src/components/shared/`)** — `StatusBadge` (solid fills, status→tone map),
`CursorPagination` (prev/next only, no page numbers), `LoadingSkeleton`, `ErrorBoundary` (class
component), `ConfirmDialog` (destructive + isLoading), `PageHeader`.

**Providers (`src/components/providers/`)** — `QueryProvider` (+ sonner Toaster),
`MerchantSessionProvider` (NextAuth), `BuyerProviders` (ClerkProvider + token bridge + a
`useBuyerMerchantId()` context fed from the `__merchant_id` cookie), `ClerkTokenBridge`.

**Feature components**
- Merchant: `DashboardKpiCard`, `ArAgingChart` (Recharts vertical bars, 5 fixed colors, click→filter),
  `GmvTrendChart` (Recharts area, flat 8% fill — not a gradient), `InvoiceTable` (mark-paid confirm,
  resend with 7-day cooldown), `BuyerApprovalPanel` (Sheet, Details/Decision tabs, PII reveal,
  approve/reject via shared Zod schemas), `PiiField`, `MerchantNav`.
- Buyer: `BulkOrderTable` (virtualized via `@tanstack/react-virtual`, CSV import, volume-break
  hint, cart, idempotency-key order submit), `BuyerNav`.

**Hooks (`src/hooks/`)** — `useMerchantDashboard` (+`useArAging`), `useBuyerCatalog` (infinite),
`useInvoices` + `useOrders` (infinite, `mode:'merchant'|'buyer'` discriminator),
`usePricingTiers`, `useBuyers` (+`usePendingApplications`/`useApproveBuyer`/`useRejectBuyer`/`useSuspendBuyer`),
`useInvoiceActions` (mark-paid/void/resend/download), `useCreateOrder`.

**App router pages/layouts (`src/app/`)**
- `layout.tsx` (root: QueryProvider + ErrorBoundary), `page.tsx` (redirects → `/merchant-login`), `globals.css`.
- `(merchant)/layout.tsx` + pages: `dashboard`, `buyers`, `invoices`, `orders`, `pricing`.
- `(buyer)/layout.tsx` (reads `__merchant_id` cookie) + **pages live under `(buyer)/portal/`**:
  `portal/catalog`, `portal/orders`, `portal/invoices`, `portal/apply` (URLs `/portal/*`).
- `(auth)/layout.tsx` (Clerk) + `buyer-login`, `buyer-signup` (Clerk `<SignIn>/<SignUp>`),
  `merchant-login` (NextAuth `signIn('shopify')`).
- `api/auth/[...nextauth]/route.ts`.
- `middleware.ts` — App-Proxy HMAC verify (sets `__merchant_domain`/`__merchant_id` cookies),
  merchant gating via `getToken`, buyer gating via Clerk session-cookie presence.

### KEY DECISIONS made this session (important — read before changing things)
1. **Package scope is `@b2b/*`, not `@wholesale-portal/*`.** CLAUDE.md uses the latter name in
   prose but the actual workspace packages are `@b2b/web`, `@b2b/api`, `@b2b/shared`, `@b2b/database`.
2. **`@b2b/shared` barrel is server-poisoned.** `@b2b/shared` (index) re-exports `utils/logger`
   (`node:async_hooks`) and `utils/crypto` (`node:crypto`), which **cannot be bundled into client/edge
   code**. Frontend code MUST import from the subpaths **`@b2b/shared/types`** (pure types) and
   **`@b2b/shared/schemas`** (zod only). Every web file already follows this — keep it that way.
3. **Buyer routes are under `/portal/*`, NOT root.** Next.js forbids two route groups resolving the
   same URL; `(buyer)/orders` collided with `(merchant)/orders`. Resolution: merchant pages at root,
   ALL buyer pages under `/portal/*`. The App-Proxy rewrite must therefore be
   `"/apps/wholesale/:path*" → "/portal/:path*"` (NOT `→ /(buyer)/:path*` as the original prompt text
   says — that target is impossible in Next).
4. **Merchant API token is an HS256 JWT signed with `NEXTAUTH_SECRET`** (not the default NextAuth
   JWE), minted in the jwt callback and surfaced as `session.accessToken`, because that is exactly
   what the existing API `MerchantSessionGuard` verifies.
5. **New public env vars the frontend needs:** `NEXT_PUBLIC_API_BASE_URL`,
   `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, plus server-side `API_BASE_URL`, `NEXTAUTH_SECRET`,
   `NEXTAUTH_URL`, `SHOPIFY_CLIENT_ID/SECRET`, `INTERNAL_API_SECRET`. (`.env.example` already lists the
   server ones; the two `NEXT_PUBLIC_*` are new and should be added there + to `env.validation` docs.)

### KNOWN ISSUES / BLOCKERS (fix these FIRST next session)
1. **`next build` fails at page-data collection on `/merchant-login`** with
   `DOMException [InvalidCharacterError]: The string to be decoded is not correctly encoded` thrown by
   `atob` inside a NextAuth chunk. typecheck is clean and webpack **compiles** — this is a
   build-time/runtime data-collection failure, not a type error. The build was run with **dummy**
   env values (`NEXTAUTH_SECRET=dummy_build_secret_…`, `SHOPIFY_CLIENT_SECRET=dummy`, etc.). Likely
   causes to investigate, in order: (a) NextAuth/Shopify provider doing a base64 decode of a
   malformed dummy secret at module-eval during static collection of `/merchant-login`; try a
   realistic base64 `NEXTAUTH_SECRET` (e.g. `openssl rand -base64 32`) and a non-"dummy"
   client secret; (b) force `/merchant-login` (and possibly the NextAuth route) to be dynamic
   (`export const dynamic = 'force-dynamic'`) so Next doesn't pre-collect it; (c) confirm the custom
   `ShopifyProvider` `authorization`/`token` URL placeholders aren't being base64-processed at build.
   **Until this is resolved the production build is red.** (Dev server `pnpm --filter @b2b/web dev`
   was not tested this session.)
2. **Reproduce the build with the exact dummy env block used this session** (see "How to verify" below).

### NOT STARTED — remaining Prompt 5 work (Tasks 11–16 + handoff)
These were never begun this session. Implement per the Prompt 5 spec the user pasted:
- **Task 11 — `apps/web/vercel.json`** (security headers + the CSP that whitelists Clerk domains,
  HSTS, X-Frame-Options DENY, COOP/COEP, etc.) and **`apps/web/next.config`** (the spec asks for
  `next.config.ts` with `images.remotePatterns` for `*.shopifycdn.com` + `img.clerk.com`,
  `output:'standalone'`, `poweredByHeader:false`, `experimental.serverActions.allowedOrigins`,
  env passthrough). **NOTE the current file is `apps/web/next.config.mjs`** (minimal:
  `transpilePackages:['@b2b/shared']`) — decide whether to convert to `.ts` or extend the `.mjs`.
  The rewrite must be `"/apps/wholesale/:path*" → "/portal/:path*"` (see Decision #3).
- **Task 12 — `.github/workflows/ci.yml`** (8-job pipeline) and **`.github/dependabot.yml`**.
- **Task 13 — `tests/load/*.k6.js`** (catalog / order-creation / invoice-download).
- **Task 14 — `playwright.config.ts` + `tests/e2e/*.spec.ts` + global setup/teardown.**
- **Task 15 — build config:** the spec wants `turbo.json`, `pnpm-workspace.yaml`, root
  `package.json`, `.lighthouse-budget.json`. `turbo.json`/`pnpm-workspace.yaml`/root `package.json`
  **already exist** from Sessions 1–2 — only ADD what's missing (e.g. lint scripts, lighthouse
  budget), do not clobber.
- **Task 16 — `docs/runbooks/secrets-rotation.md`, `docs/runbooks/disaster-recovery.md`,
  `docs/deployment-checklist.md`, and a real `README.md`** (current `README.md` is a 45-byte stub).
- **Final handoff requirements** (handoff summary table, platform summary, launch-readiness checklist).

### API-contract gaps the frontend assumes but the API may NOT yet expose
The hooks/pages call these endpoints; confirm they exist in `apps/api` or add them:
- `GET /invoices` (merchant invoice list, cursor) — **no merchant invoice LIST endpoint existed** in
  the API as of Session 2 (only ar-aging, integrity, mark-paid, void, resend, buyer download). The
  `useInvoices({mode:'merchant'})` hook + merchant `InvoiceTable` depend on it.
- `GET /buyer/invoices` (buyer invoice list, cursor) — used by `useInvoices({mode:'buyer'})`.
- `GET /buyer/catalog` (cursor + `search`) — `CatalogService` exists; confirm a controller route is wired.
- `GET /buyers/applications?status=pending` (pending applications list) — `usePendingApplications`
  expects an array; the controller had approve/reject but confirm the LIST route exists.
- `GET /orders` and `GET /buyer/orders` lists — exist per Session 2 (orders controller).
- GraphQL `getMerchantDashboard` + `getArAging` — exist (resolvers present).
- The merchant dashboard **GMV trend** is currently derived client-side from current/previous month
  (a 2-point series) because there is no daily-series endpoint; replace when one is added.

### HOW TO VERIFY (Session 3 state) — copy/paste
```bash
cd /root/wholesale-portal
# typecheck (currently CLEAN):
pnpm --filter @b2b/web typecheck
# build (currently RED at page-data collection — see Known Issue #1):
export NEXTAUTH_SECRET=dummy_build_secret_0123456789abcdef \
  SHOPIFY_CLIENT_ID=dummy SHOPIFY_CLIENT_SECRET=dummy \
  NEXT_PUBLIC_API_BASE_URL=https://api.example.com \
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_dummy \
  NEXTAUTH_URL=https://app.example.com PLATFORM_DOMAIN=app.example.com
pnpm --filter @b2b/web build
```
Note: `.npmrc` points pnpm at `registry.npmmirror.com` (the default registry is unreachable here);
keep it for installs in this environment.

---

## SESSION 2 — COMPLETED (resumes Prompt 3 Task 6)

**Goal:** continue from the Session-1 handoff — fix the two known compile errors, write the
Prompt-3 controllers, wire the modules, and re-verify. **All done.**

### Compile-error fixes
1. **`orders/orders.service.ts`** — the previously-unused `NotFoundException` import is now used:
   added **`getOrderDetail(merchantId, orderId, buyerId?)`** (full header + line items + invoice
   summary; merchant-scoped, optional buyer-ownership enforcement; throws `ORDER_NOT_FOUND`).
   Added `OrderDetail` + `OrderLineDetail` result interfaces.
2. **`workers/invoice-generate.worker.ts`** — updated the `sendInvoiceEmail` call to the new
   `InvoiceEmailParams` shape: passes `merchantName` (`merchant.shopifyDomain`), `paymentTerms`
   (human label), `presignedUrl` (the presigned `downloadUrl`), and `lineItems` (mapped from the
   order lines); dropped the removed `downloadUrl` field.

### New files
| File | Purpose |
|---|---|
| `apps/api/src/orders/orders.controller.ts` | Buyer (`POST/GET /buyer/orders`, `GET /buyer/orders/:id`) + merchant (`GET /orders`, `GET /orders/:id`) routes |
| `apps/api/src/invoices/invoices.controller.ts` | Merchant AR routes (ar-aging, integrity, mark-paid, void, resend) + buyer PDF download |

### Modified files
| File | Change |
|---|---|
| `apps/api/src/orders/orders.service.ts` | Added `getOrderDetail` + `OrderDetail`/`OrderLineDetail` types (fixes unused import) |
| `apps/api/src/invoices/invoices.service.ts` | Added `resendInvoiceEmail(invoiceId, merchantId)` (rebuilds + sends invoice email with fresh presigned URL) |
| `apps/api/src/orders/orders.module.ts` | Wired: `imports: [AuthModule]`, `controllers: [OrdersController]`, `providers/exports: [OrdersService]` |
| `apps/api/src/invoices/invoices.module.ts` | Wired: `imports: [AuthModule]`, `controllers: [InvoicesController]`, added `InvoicesService` to providers/exports (kept `@Global` + `InvoicePdfService` export for the worker) |
| `apps/api/src/workers/invoice-generate.worker.ts` | Fixed stale email call (above) |
| `apps/api/src/workers/worker-helpers.ts` | Added shared `PAYMENT_TERMS_LABELS` map (used by the worker email) |

### Controller route map (as built)
- **Buyer (ClerkBuyerGuard):**
  - `POST /buyer/orders` — requires `Idempotency-Key` header → else 400 `IDEMPOTENCY_KEY_REQUIRED`;
    merchant tenant taken from the guard (App-Proxy cookie), never the body. Validates `BulkOrderSchema`.
  - `GET /buyer/orders` — cursor paginated (`CursorPaginationSchema`).
  - `GET /buyer/orders/:id` — `getOrderDetail` with buyer-ownership enforcement.
  - `GET /buyer/invoices/:id/download` — presigned PDF URL (ownership checked in the service).
- **Merchant (MerchantSessionGuard + RolesGuard):**
  - `GET /orders` (+ `status`/`buyerId`/`dateFrom`/`dateTo` filters), `GET /orders/:id`.
  - `GET /invoices/ar-aging`.
  - `GET /invoices/:id/integrity`, `PATCH /invoices/:id/mark-paid`, `PATCH /invoices/:id/void`,
    `POST /invoices/:id/resend` — all `@Roles('owner','admin')`.
  - `POST /invoices/:id/resend` is rate-limited per invoice via Redis key `invoice:resend:{id}`
    (300s window) → 429 `RESEND_RATE_LIMITED` with `Retry-After`.

### Notes / decisions this session
- Guards are provided to the feature modules by **importing `AuthModule`** (which provides+exports
  all four guards); their own deps (config, Prisma, MerchantContext, Reflector) are global.
- `mark-paid` reuses the shared `MarkPaidSchema` (body `amount`→ service `amountPaid`); `void` uses a
  small controller-local Zod `VoidInvoiceSchema` (no shared schema existed).
- `ParseUUIDPipe({version:'4'})` guards all `:id` params before the service's own UUID assert.

### Still remaining (unchanged from Session 1, NOT done this session)
- **Phase 4 — web NextAuth restore:** `apps/web/src/lib/auth-options.ts`, `[...nextauth]/route.ts`,
  `next-auth.d.ts`, `next.config.js` — still not created (out of scope of this session's task list).
- **Deferred schema work:** buyers `passwordHash`/`loginFailCount`/`lockedUntil` removal;
  `merchant_users` password/mfa restoration; Prompt 4's `'defaulted'` `InvoiceStatus`.
- **Migration 004** authored but not applied (no live DB in this environment).

---

> **Original Session-1 handoff below (historical).** Status lines such as "BROKEN", "not wired",
> and "NOT RUN" are superseded by the section above.

---

# CONTEXT_HANDOFF_FINAL.md (Session 1)

_Generated: 2026-06-15. Single source of truth for resuming this project in a brand-new session._

> **READ FIRST:** The repository is currently in a **non-compiling state**. Two definite
> compile errors are known (documented under *Known Compile Errors*) and the Prompt-3
> controllers + module wiring were **not** written before the session ended. The build was
> **not runnable this session** because the Bash safety classifier was in a persistent outage —
> `prisma generate`, `tsc`, and `jest` could not be executed. Build/typecheck/test status below
> is therefore **determined analytically from the source**, not from a clean run. The next
> session MUST run the verification commands first.

---

## Executive Summary

This session executed **Prompt 3** (Orders + Invoices + Storage + Email) on top of a decision to
**honor CLAUDE.md's NextAuth-for-merchants architecture**, which required first **reverting the
committed all-Clerk merchant-auth migration**. The merchant-auth revert (Phase 1) and the schema
`clerkOrgId` removal (Phase 2) are **complete**. The core Prompt-3 **services** (Orders, Invoices,
enhanced Invoice PDF, extended Storage, rewritten Email + 5 templates) are **written**. The
**REST controllers and NestJS module wiring (Task 6) were NOT written**, and a signature change to
`EmailService.sendInvoiceEmail` **broke an existing caller** in the invoice-generate worker.

Net state: **~80% of Prompt 3 implemented; build currently broken; controllers + wiring + one
worker fix remain.**

---

## Original Objective

Continue the B2B Wholesale Portal build. The user sent "continue" to execute **Prompt 3 (Tasks 1–6)**:

1. `OrdersService` — server-side priced bulk orders, optimistic credit locking, Shopify draft
   compensation, SERIALIZABLE retry.
2. `InvoicePdfService` — `@react-pdf/renderer`, SHA-256, 15s timeout, full accounting-document layout.
3. `InvoicesService` — generate/store, integrity verify, presigned URL, void, mark-paid, AR-aging CTE,
   overdue/reminder/sequence-gap crons.
4. `StorageService` — S3 SSE-KMS, presigned URLs, path-traversal prevention.
5. `EmailService` — Resend via circuit breaker, 8 non-throwing methods, 5 React-Email templates.
6. REST controllers (`orders.controller.ts`, `invoices.controller.ts`) + module wiring.

A blocking contradiction surfaced (see *Auth Decision Analysis*); the user chose **"Honor CLAUDE.md
(NextAuth)"**, which expanded scope to include reverting the committed all-Clerk merchant auth.

---

## Repository State Before Session

- Branch `master`, latest commit `9354bdd` ("Prompt 2 complete - Clerk migration, webhooks, queues,
  workers, catalog, pricing").
- Prompts 1 & 2 delivered: monorepo, Prisma schema (13 tables), shared package, NestJS infra
  (Prisma/RLS, Redis, crypto, circuit breaker, rate-limit, idempotency, tenant interceptor), Shopify
  API service, webhooks, 5 queues + 7 workers, catalog + pricing services, **minimal** storage/email
  services and an invoice-pdf service.
- **Merchant auth was all-Clerk** (`ClerkMerchantGuard`, `merchants.clerkOrgId`) — contradicting the
  current `CLAUDE.md`.
- `orders/` and `invoices/` were empty module scaffolds (no services/controllers). `apps/web/src` was
  effectively empty (NextAuth deleted by the prior session).

---

## Work Completed

### Phase 1 — Merchant auth reverted to NextAuth (COMPLETE)
- Created `MerchantSessionGuard` verifying a NextAuth **HS256** JWT (`jsonwebtoken`, `NEXTAUTH_SECRET`),
  resolving the active merchant as SYSTEM, attaching `request.merchant = {merchantId, shopifyDomain,
  role, userId}`. Codes: `MISSING_TOKEN`, `INVALID_TOKEN`, `MERCHANT_INACTIVE`.
- Created `@Roles(...)` decorator + `RolesGuard` (403 `INSUFFICIENT_ROLE`).
- Created `ClerkAuthenticatedGuard` (pre-approval buyer routes; attaches `request.buyerIdentity`).
- Deleted `clerk-merchant.guard.ts`; rewired `auth.module.ts` to provide/export the new guards.
- Repointed the type-only `MerchantAuthenticatedRequest` import in `rate-limit.guard.ts` and
  `tenant-context.interceptor.ts` to `merchant-session.guard`.
- Rewrote `clerk-webhooks.controller.ts`: removed `organization.created`/`onOrganizationCreated`
  (the only `clerkOrgId` writer); added CLAUDE.md `user.updated` → `emailVerifiedAt` sync; kept
  `user.created`/`user.deleted`.
- Added `NEXTAUTH_SECRET` (min 32, required) to `env.validation.ts` (`AppConfig` + Joi schema).

### Phase 2 — Schema `clerkOrgId` removal (COMPLETE in source; client NOT regenerated)
- Removed `clerkOrgId` from `Merchant` in `schema.prisma`.
- Authored `packages/database/migrations/004_drop_merchant_clerk_org_id.sql`.
- **`prisma generate` was NOT run** (Bash outage) — the generated client still contains `clerkOrgId`
  (harmless: no source references it).

### Phase 3 — Prompt 3 services (WRITTEN; not wired; not typecheck-verified)
- **Task 1** `orders/orders.service.ts` — `createBulkOrder` (server-side pricing, FOR SHARE +
  optimistic credit CAS w/ 3 retries, Shopify draft create→complete with delete-compensation +
  credit-release, SERIALIZABLE persist w/ 40001 retry, audit), `getOrdersForMerchant`,
  `getOrdersForBuyer` (cursor pagination). **(See Known Compile Errors — has an unused import.)**
- **Task 2** `invoices/invoice-pdf.service.ts` — enhanced to the full Task-2 layout (IBM Plex font
  register, bill-to + address, SKU column, summary, payment box, "Page X of Y" footer,
  `InvoiceRenderTimeoutError`). `generate()` kept worker-compatible.
- **Task 3** `invoices/invoices.service.ts` — `generateAndStoreInvoice`, `verifyPdfIntegrity`,
  `getPresignedUrl` (ownership + atomic first-view), `voidInvoice`, `markAsPaid` (FOR UPDATE + GMV
  rollover + credit decrement), `getArAging` (single CTE, zero-filled 5 buckets), `@Cron`
  overdue/reminders/sequence-gap.
- **Task 4** `storage/storage.service.ts` — added `getPresignedUrl` (invoices/ prefix validation →
  `PATH_TRAVERSAL_ATTEMPT`), `deleteObject` (audited), `downloadObject`; kept `uploadInvoice` +
  `presignDownload` (now delegates) for the worker. **Now injects `PrismaService`** (for deletion audit).
- **Task 5** `email/email.service.ts` — rewritten: 8 non-throwing methods returning
  `{sent, messageId?}`, circuit-breaker delivery returning the Resend message id. Plus
  `email/templates/` (`layout.ts` + 5 templates: invoice, payment-reminder, buyer-approval,
  buyer-rejection, merchant-new-application).

---

## Work Partially Completed

- **`orders/orders.service.ts`** — last edit added a `NotFoundException` import in preparation for a
  `getOrderDetail(merchantId, orderId)` method (needed by `GET /orders/:id`) that was **never written**.
  Result: an **unused import** (compile error under `noUnusedLocals`). `getOrderDetail` still must be added.

## Work Not Started

- **Task 6 controllers**: `orders/orders.controller.ts` and `invoices/invoices.controller.ts` — **not created.**
- **Module wiring**: `OrdersModule` and `InvoicesModule` not updated to register the new
  controllers/services (currently the services are unreferenced by any module).
- **invoice-generate.worker.ts** not updated for the new `sendInvoiceEmail` signature (**compile error**).
- **Phase 4 (web NextAuth restore)**: `apps/web/src/lib/auth-options.ts`, `[...nextauth]/route.ts`,
  `next-auth.d.ts`, `next.config.js` — **not created** (web app still effectively empty).
- **Deferred (by plan, not started)**: buyers field cleanup (`passwordHash`/`loginFailCount`/`lockedUntil`)
  + `merchant_users` password/mfa restoration from CLAUDE.md's schema FINAL STATE; all Prompt 4 work
  (incl. adding `'defaulted'` to `InvoiceStatus`).

---

## Files Created (this session)

| File | Purpose |
|---|---|
| `apps/api/src/auth/guards/merchant-session.guard.ts` | NextAuth HS256 merchant guard |
| `apps/api/src/auth/guards/roles.guard.ts` | `@Roles` enforcement |
| `apps/api/src/auth/guards/clerk-authenticated.guard.ts` | Pre-approval buyer guard |
| `apps/api/src/auth/decorators/roles.decorator.ts` | `@Roles(...)` + `ROLES_METADATA_KEY` |
| `apps/api/src/orders/orders.service.ts` | OrdersService (Task 1) — **has unused-import error** |
| `apps/api/src/invoices/invoices.service.ts` | InvoicesService (Task 3) |
| `apps/api/src/email/templates/layout.ts` | Shared email HTML helpers |
| `apps/api/src/email/templates/invoice.email.ts` | Invoice email template |
| `apps/api/src/email/templates/payment-reminder.email.ts` | Reminder template (tone 1/2/3) |
| `apps/api/src/email/templates/buyer-approval.email.ts` | Approval template |
| `apps/api/src/email/templates/buyer-rejection.email.ts` | Rejection template |
| `apps/api/src/email/templates/merchant-new-application.email.ts` | Merchant alert template |
| `packages/database/migrations/004_drop_merchant_clerk_org_id.sql` | Drop `merchants.clerk_org_id` |
| `CONTEXT_HANDOFF_FINAL.md` | This document |

## Files Modified (this session)

| File | Change |
|---|---|
| `apps/api/src/auth/auth.module.ts` | Provide/export new guards; drop `ClerkMerchantGuard` |
| `apps/api/src/auth/clerk-webhooks.controller.ts` | Drop org handler; add `user.updated` email-verify sync |
| `apps/api/src/common/guards/rate-limit.guard.ts` | Repoint `MerchantAuthenticatedRequest` import |
| `apps/api/src/common/interceptors/tenant-context.interceptor.ts` | Repoint import |
| `apps/api/src/config/env.validation.ts` | Add `NEXTAUTH_SECRET` |
| `apps/api/src/email/email.service.ts` | Rewrite to 8 methods + templates (**signature change**) |
| `apps/api/src/invoices/invoice-pdf.service.ts` | Full accounting-document layout |
| `apps/api/src/storage/storage.service.ts` | `getPresignedUrl`/`deleteObject`/`downloadObject`; inject Prisma |
| `packages/database/prisma/schema.prisma` | Remove `Merchant.clerkOrgId` |
| `CLAUDE.md` | (pre-existing working-tree edit — not changed by me beyond prior state) |
| `.claude/settings.local.json` | Tooling (incidental) |

## Files Deleted (this session)

| File | Reason |
|---|---|
| `apps/api/src/auth/guards/clerk-merchant.guard.ts` | Forbidden by CLAUDE.md; merchant auth is NextAuth |

---

## Architectural Decisions

- **Merchant auth = NextAuth v4 + Shopify OAuth** (HS256, `NEXTAUTH_SECRET`); API verifies via
  `MerchantSessionGuard`. Buyer auth = **Clerk**. This is the CLAUDE.md-mandated split.
- **Two-layer tenancy preserved**: app-level `where:{merchantId}` + Postgres RLS. New services run reads
  under `merchantContext.run(merchantId)`; multi-step writes set RLS GUC inside the transaction
  (`withTenantTransaction` or explicit `SET LOCAL app.current_merchant_id` for SERIALIZABLE txns).
- **Money**: Decimal.js with `ROUND_HALF_EVEN` everywhere; never native floats.
- **Financial writes**: SERIALIZABLE for order persistence (retry on PG `40001`/Prisma `P2034`);
  `FOR UPDATE` on mark-paid; optimistic version CAS for credit.
- **Idempotency** for `POST /buyer/orders` is owned by the existing global `IdempotencyMiddleware`
  (reserve → replay cached response). The service does not duplicate it (no `orders.idempotencyKey` column).
- **Email never throws**; failures → Sentry + `{sent:false}`.
- **Credit reservation** happens before Shopify; released on any downstream failure.

---

## Auth Decision Analysis

**The contradiction:** `CLAUDE.md` (authoritative, "always wins", edited today) mandates NextAuth +
Shopify OAuth for merchants via `MerchantSessionGuard`, and explicitly lists `clerk-merchant.guard.ts`
as a file that must **never exist**. But the **committed code** (`9354bdd`) had done an **all-Clerk**
migration: `ClerkMerchantGuard`, `merchants.clerkOrgId`, `request.merchant.{clerkOrgId,clerkUserId,
subscriptionTier}`, and deleted NextAuth. Prompt 3's controllers import `MerchantSessionGuard` and read
`request.merchant.userId` — neither existed. `CONTEXT_HANDOFF.md` + memory recorded the all-Clerk
migration as "done", directly conflicting with CLAUDE.md.

**Resolution:** Asked the user; they chose **"Honor CLAUDE.md (NextAuth)"**. Phase 1 + Phase 2 above
implement that reversal.

**Secondary contradiction (still open):** the Prisma schema is **half-migrated** vs CLAUDE.md's schema
FINAL STATE — `buyers` still has `passwordHash` (NOT NULL), `loginFailCount`, `lockedUntil` **and**
`clerkUserId`; `merchant_users` was stripped of the password/mfa fields CLAUDE.md says to keep. This was
**deliberately deferred** (buyer-auth concern, orthogonal to the merchant decision, cascades into
`seed.ts` + `merchants.service.ts`, cannot be DB-verified here).

---

## Database / Prisma Status

- **Schema change made:** `Merchant.clerkOrgId` removed.
- **Migration created:** `packages/database/migrations/004_drop_merchant_clerk_org_id.sql`
  (`ALTER TABLE merchants DROP COLUMN IF EXISTS clerk_org_id;`). Apply via direct (5432) connection.
- **Pending Prisma command:** `pnpm --filter @b2b/database exec prisma generate` (NOT run this session).
- **Pending schema work (deferred):** buyers `passwordHash`/`loginFailCount`/`lockedUntil` removal;
  `merchant_users` password/mfa restoration; Prompt 4's `'defaulted'` `InvoiceStatus` enum value.
- **No live DB** in this environment → migrations authored, **not applied**; runtime not exercised.

---

## Orders Module Status

- `orders.service.ts` **written** (all 3 methods). **Compile error:** unused `NotFoundException` import
  (intended for the unwritten `getOrderDetail`).
- `getOrderDetail(merchantId, orderId)` for `GET /orders/:id` — **must be added**.
- `orders.controller.ts` — **not created**.
- `orders.module.ts` — still empty `@Module({})`; must register controller + `OrdersService`.

## Invoices Module Status

- `invoices.service.ts` **written** (generate/verify/presign/void/mark-paid/AR-aging/3 crons).
- `invoice-pdf.service.ts` **enhanced**.
- `invoices.controller.ts` — **not created**.
- `invoices.module.ts` — currently provides only `InvoicePdfService`; must add `InvoicesService` +
  controller (keep `@Global` export of `InvoicePdfService` for the worker).

## Storage Module Status

- `storage.service.ts` **extended** and **now depends on `PrismaService`** (global, DI OK).
- New: `getPresignedUrl`, `deleteObject`, `downloadObject`. Kept: `uploadInvoice`, `presignDownload`.
- Upload key changed to `invoices/{merchantId}/{year}/{invoiceNumber}.pdf` (worker stores returned key — OK).

## Email Module Status

- `email.service.ts` **rewritten**: 8 methods, non-throwing, `{sent, messageId?}`.
- **BREAKING:** `sendInvoiceEmail` params changed (now requires `merchantName`, `paymentTerms`,
  `presignedUrl`, `lineItems`; removed `downloadUrl`). `invoice-generate.worker.ts` still calls the OLD
  shape → **compile error** (see below).
- **Documented deviation:** templates are typed **inline-HTML render functions**, NOT
  `@react-email/components` `.tsx`. The package is not installed and the registry is an offline mirror;
  installation could not be attempted (Bash outage). Swap-in later behind `RenderedEmail`.

## Frontend Status

- `apps/web` untouched this session. `apps/web/src` is effectively empty (NextAuth previously deleted).
- Deps present (no install needed): `next@14`, `next-auth@4.24.8`, `react-dom`, `jsonwebtoken`.
- **Phase 4 not started:** `auth-options.ts`, `[...nextauth]/route.ts`, `next-auth.d.ts`, `next.config.js`.

---

## Build Status

**BROKEN — not runnable this session (Bash classifier outage).** Determined analytically:
`apps/api` will **fail** to build (`nest build`) and typecheck due to the two definite errors below,
plus unverified type risks in the two new services. `prisma generate` was not run (does not affect
compilation of new code, since no source references `clerkOrgId`).

## Typecheck Status

**FAIL (analytical).** Could not run `tsc -p apps/api/tsconfig.json --noEmit`. `apps/web` typecheck
unaffected by this session (no web changes).

## Test Status

**NOT RUN.** Pricing unit tests (19/19 previously) untouched and expected to still pass once the API
compiles; cannot confirm this session.

---

## Known Issues

### Known Compile Errors (definite)
1. **`apps/api/src/orders/orders.service.ts`** — `NotFoundException` is imported but unused →
   `TS6133` under `noUnusedLocals`. (Introduced by an incomplete edit prepping `getOrderDetail`.)
   Fix: either add `getOrderDetail` (which uses it) or remove the import.
2. **`apps/api/src/workers/invoice-generate.worker.ts`** (~lines 249–263) — calls
   `this.email.sendInvoiceEmail({ to, buyerCompany, invoiceNumber, total, currency, dueDate, downloadUrl })`,
   which no longer matches `InvoiceEmailParams` (missing `merchantName`, `paymentTerms`, `presignedUrl`,
   `lineItems`; `downloadUrl` removed). Fix: build `lineItems` from the order line items, pass
   `merchantName: merchant.shopifyDomain`, `paymentTerms` (human label), and `presignedUrl: downloadUrl`.

### Known Runtime Risks / unverified type risks
- `orders.service.ts` `getOrdersForMerchant/Buyer`: the Prisma `findMany(select…)` result is passed to a
  hand-typed `toPage(rows…)` param — structural assignability (enum vs string, `Prisma.Decimal`) is
  **unverified**; may need the param types widened to match Prisma's generated select type.
- `invoices.service.ts`: dynamic `await import('node:crypto')` under CommonJS, `Prisma.JsonValue` handling
  in `formatAddress`, `$executeRaw` return-as-number usage, and `@Cron` registration — unverified by tsc.
- `invoice-pdf.service.ts`: `@react-pdf` style-array props and the `Text render={…}`/`fixed` props are
  valid in the installed version but unverified here.
- Module wiring absent → even after compile fixes, `OrdersService`/`InvoicesService`/controllers won't be
  instantiated until registered (Nest DI is a runtime concern, not a compile error).
- New services are **not referenced by any module** yet, so they ARE typechecked (`include: src/**/*.ts`)
  but not booted.

---

## Remaining Work (priority order)

1. **Fix the two known compile errors** (worker email call; orders unused import — add `getOrderDetail`).
2. **Write Task 6 controllers** `orders.controller.ts` + `invoices.controller.ts` (guards: merchant =
   `MerchantSessionGuard` + `RolesGuard`/`@Roles`; buyer = `ClerkBuyerGuard`; Idempotency-Key required on
   `POST /buyer/orders` → 400 `IDEMPOTENCY_KEY_REQUIRED`; resend rate-limit Redis key
   `invoice:resend:{id}` → 429).
3. **Wire modules**: register controllers + services in `OrdersModule`/`InvoicesModule` (import nothing
   special — Pricing/Shopify/Storage/Email/Prisma are all `@Global`).
4. `pnpm --filter @b2b/database exec prisma generate`.
5. **Typecheck/build** API; fix the unverified type risks above.
6. **Phase 4**: restore web NextAuth (`auth-options.ts`, `[...nextauth]/route.ts`, `next-auth.d.ts`,
   `next.config.js`).
7. **Verification gate**: `pnpm typecheck`, `nest build`, pricing unit tests.
8. (Deferred, confirm with user) CLAUDE.md schema FINAL STATE: buyers/merchant_users field reshaping;
   then Prompt 4.

---

## Recommended First Action In Next Session

Run the verification commands (below) to get the **actual** compiler error list, then fix the two known
errors and write the two controllers + module wiring (items 1–3). Do this before anything else — the
services are written but the project does not compile or boot without them.

---

## Exact Commands To Resume Work

```bash
cd /root/wholesale-portal

# 1. Regenerate the Prisma client against the clerkOrgId-removed schema.
pnpm --filter @b2b/database exec prisma generate

# 2. Get the real compiler error list (the gate).
./node_modules/.bin/tsc -p apps/api/tsconfig.json --noEmit

# 3. After fixes: full build + tests.
pnpm --filter @b2b/api build
pnpm --filter @b2b/api test -- --testPathPattern=pricing
pnpm --filter @b2b/web typecheck   # only relevant once Phase 4 web files exist

# Migration (when a DB is available; direct 5432 connection):
#   apply packages/database/migrations/004_drop_merchant_clerk_org_id.sql
```

---

## Final Notes

- **No live database** in this environment; all DB verification is typecheck-only.
- **`@react-email/components` is NOT installed** and the registry is an offline mirror — the email
  templates use an inline-HTML fallback (documented deviation, behind `RenderedEmail`).
- The merchant-auth revert is the riskiest completed change; confirm `rate-limit.guard.ts` and
  `tenant-context.interceptor.ts` still read only `request.merchant.merchantId` (they do).
- Do not re-introduce `clerk-merchant.guard.ts` or `merchants.clerkOrgId`.

---

## Git Status Snapshot

**Branch:** `master`
**Latest commit:** `9354bdd38b18fd913c7c7e034968d490e6e596c1` — "Prompt 2 complete - Clerk migration,
webhooks, queues, workers, catalog, pricing"

### `git status` (porcelain, captured this session)

```
 M .claude/settings.local.json
 M CLAUDE.md
 M apps/api/src/auth/auth.module.ts
 M apps/api/src/auth/clerk-webhooks.controller.ts
 D apps/api/src/auth/guards/clerk-merchant.guard.ts
 M apps/api/src/common/guards/rate-limit.guard.ts
 M apps/api/src/common/interceptors/tenant-context.interceptor.ts
 M apps/api/src/config/env.validation.ts
 M apps/api/src/email/email.service.ts
 M apps/api/src/invoices/invoice-pdf.service.ts
 M apps/api/src/storage/storage.service.ts
 M packages/database/prisma/schema.prisma
?? apps/api/src/auth/decorators/
?? apps/api/src/auth/guards/clerk-authenticated.guard.ts
?? apps/api/src/auth/guards/merchant-session.guard.ts
?? apps/api/src/auth/guards/roles.guard.ts
?? apps/api/src/email/templates/
?? apps/api/src/invoices/invoices.service.ts
?? apps/api/src/orders/orders.service.ts
?? packages/database/migrations/004_drop_merchant_clerk_org_id.sql
```

(Plus, after this file is written: `?? CONTEXT_HANDOFF_FINAL.md`.)

### `git diff --stat` (tracked files, captured this session)

```
 .claude/settings.local.json                        |   8 +-
 CLAUDE.md                                          | 954 ++++++++++-----------
 apps/api/src/auth/auth.module.ts                   |  23 +-
 apps/api/src/auth/clerk-webhooks.controller.ts     |  50 +-
 apps/api/src/auth/guards/clerk-merchant.guard.ts   | 113 ---
 apps/api/src/common/guards/rate-limit.guard.ts     |   2 +-
 .../interceptors/tenant-context.interceptor.ts     |   2 +-
 apps/api/src/config/env.validation.ts              |   9 +-
 apps/api/src/email/email.service.ts                | 274 +++++-
 apps/api/src/invoices/invoice-pdf.service.ts       | 301 +++++--
 apps/api/src/storage/storage.service.ts            | 105 ++-
 packages/database/prisma/schema.prisma             |   1 -
 12 files changed, 1070 insertions(+), 772 deletions(-)
```

> Note: `git diff --stat` shows only tracked/modified files. New files (orders/invoices services,
> guards, decorators, email templates, migration 004) are untracked and appear under `git status` above.

---

## Appendix — Live `git status` / `git diff --stat` (re-run at handoff time)

### `git status`

```
On branch master
Changes not staged for commit:
	modified:   .claude/settings.local.json
	modified:   CLAUDE.md
	modified:   apps/api/src/auth/auth.module.ts
	modified:   apps/api/src/auth/clerk-webhooks.controller.ts
	deleted:    apps/api/src/auth/guards/clerk-merchant.guard.ts
	modified:   apps/api/src/common/guards/rate-limit.guard.ts
	modified:   apps/api/src/common/interceptors/tenant-context.interceptor.ts
	modified:   apps/api/src/config/env.validation.ts
	modified:   apps/api/src/email/email.service.ts
	modified:   apps/api/src/invoices/invoice-pdf.service.ts
	modified:   apps/api/src/storage/storage.service.ts
	modified:   packages/database/prisma/schema.prisma

Untracked files:
	CONTEXT_HANDOFF_FINAL.md
	apps/api/src/auth/decorators/
	apps/api/src/auth/guards/clerk-authenticated.guard.ts
	apps/api/src/auth/guards/merchant-session.guard.ts
	apps/api/src/auth/guards/roles.guard.ts
	apps/api/src/email/templates/
	apps/api/src/invoices/invoices.service.ts
	apps/api/src/orders/orders.service.ts
	packages/database/migrations/004_drop_merchant_clerk_org_id.sql
```

### `git diff --stat`

```
 .claude/settings.local.json                        |   8 +-
 CLAUDE.md                                          | 954 ++++++++++-----------
 apps/api/src/auth/auth.module.ts                   |  23 +-
 apps/api/src/auth/clerk-webhooks.controller.ts     |  50 +-
 apps/api/src/auth/guards/clerk-merchant.guard.ts   | 113 ---
 apps/api/src/common/guards/rate-limit.guard.ts     |   2 +-
 .../interceptors/tenant-context.interceptor.ts     |   2 +-
 apps/api/src/config/env.validation.ts              |   9 +-
 apps/api/src/email/email.service.ts                | 274 +++++-
 apps/api/src/invoices/invoice-pdf.service.ts       | 301 +++++--
 apps/api/src/storage/storage.service.ts            | 105 ++-
 packages/database/prisma/schema.prisma             |   1 -
 12 files changed, 1070 insertions(+), 772 deletions(-)
```
