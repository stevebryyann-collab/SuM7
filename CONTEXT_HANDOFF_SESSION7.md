# CONTEXT_HANDOFF_SESSION7.md — Group 1 in progress

_Authoritative READ-FIRST handoff. Supersedes SESSION6 for **current state only**._
_For the full journey gap-analysis + 4-group plan, SESSION6 §4–§5 and
`/root/.claude/plans/polished-coalescing-tarjan.md` remain valid. Do NOT re-audit._

---

## PROJECT OVERVIEW

- **App:** Financial-grade, Shopify-embedded **B2B Wholesale operating-system SaaS** (launch
  vertical: Fashion & Apparel). Merchants get unlimited pricing tiers, spreadsheet bulk ordering,
  self-serve buyer onboarding, PDF invoicing, AR, and BNPL (Resolve).
- **Goal (active phase):** make the app match the COMPLETE USER JOURNEY spec — every screen,
  button, state — production-grade, secure, no dead buttons, build green after every phase.
- **Stack:** Turborepo pnpm monorepo, scope **`@b2b/*`**. `apps/web` = Next.js 14 App Router
  (Vercel). `apps/api` = NestJS 10 REST+GraphQL (Railway). `packages/shared` (Zod/types),
  `packages/database` (Prisma 5, Supabase PG16). Money = Decimal.js ROUND_HALF_EVEN. Financial
  writes = Serializable `$transaction`. RLS + app-level `where:{merchantId}`. Cursor pagination only.
  Merchant auth = NextAuth+Shopify (HS256/`NEXTAUTH_SECRET`); buyer auth = Clerk. Never mix.
- **Branch:** `main` @ `53fc4ad`. Nothing committed past it; all Prompt-5 web is untracked under
  `?? apps/web/src/`. **No live DB** — verification is typecheck/demo only.

---

## WHAT HAS BEEN COMPLETED (this session — Group 1, backend + types)

### Task 1 — Backend buyer endpoints ✅ (API typecheck green)
**`apps/api/src/buyers/buyers.service.ts`:**
- Import: added `UpdateBuyerInput` from `@b2b/shared`.
- `ApplicationListItem` reshaped: **removed `taxId`/`phone`**, added `hasTaxId`/`hasPhone`. Added
  `ApplicationPii` interface (`{taxId, phone}`).
- Added `BuyerDetail` interface (after `BuyerSummary`); added `BuyerDetailRow` + `LockedRelationshipRow`
  raw-row interfaces (after `BuyerListRow`).
- `listApplicationsForMerchant`: still selects taxId/phone internally but maps to `hasTaxId`/`hasPhone`
  only — **no plaintext PII in the list payload** (security fix).
- New methods: `revealApplicationPii()` (audited `pii_revealed`, returns plaintext from applications
  table — plaintext at rest, control is access+audit), `reinstateBuyer()` (Serializable + FOR UPDATE,
  suspended→approved, 409 `NOT_SUSPENDED` otherwise), `updateBuyer()` (Serializable + FOR UPDATE;
  pricingTierId/paymentTerms/creditLimit/notes; validates tier ownership; audits changes+previous),
  `getBuyerDetail()` (aggregate query, no PII). Private helper `lockRelationship()` added after
  `lockApplication()`.

**`apps/api/src/buyers/buyers.controller.ts`:** added `Patch` import, `UpdateBuyerSchema`/
`UpdateBuyerInput` imports, `ApplicationPii`/`BuyerDetail` imports. New routes (all
`MerchantSessionGuard`+`RolesGuard` `@Roles('owner','admin')`): `POST buyers/applications/:id/reveal`
(200), `POST buyers/:buyerId/reinstate` (204), `GET buyers/:buyerId`, `PATCH buyers/:buyerId` (204).
**Param routes declared AFTER static `buyers/applications*` routes** (Express match-order).

### Task 2 — Shared schema ✅
`UpdateBuyerSchema` + `UpdateBuyerInput` already existed in `packages/shared/src/schemas/index.ts`
(lines ~228–238: pricingTierId/paymentTerms/creditLimit/notes, all optional, ≥1 required). Now consumed.

### NEW BACKEND API CONTRACT (bare paths; reuse — do not rebuild)
- `GET /buyers/:buyerId` → `BuyerDetail`
- `PATCH /buyers/:buyerId` body `{pricingTierId?,paymentTerms?,creditLimit?,notes?}` → 204
- `POST /buyers/:buyerId/reinstate` → 204
- `POST /buyers/applications/:id/reveal` → `{taxId,phone}` (200)

### PRICING API CONTRACT (already existed, unchanged — `apps/api/src/pricing/pricing-tiers.controller.ts`)
Mount `/api/v1/pricing-tiers`, guards `MerchantSessionGuard`+`RolesGuard`:
- `GET /` → `PricingTierSummary[]`
- `POST /` (owner/admin) → `{id}` 201
- `GET /:id?cursor&limit` → `PricingTierDetail` (= summary + `conditionsJson` + `overrides:PaginatedResponse<OverrideSummary>`)
- `PATCH /:id` (owner/admin) → 204
- `DELETE /:id` (**owner only**) → 204 (409 `TIER_HAS_ACTIVE_BUYERS` if buyers assigned)
- `POST /:id/overrides/bulk` (owner/admin) → `{upserted}` 200
- `DELETE /:id/overrides/:overrideId` (owner/admin) → 204

---

## WHAT IS PARTIALLY COMPLETED

### Task 3 — Demo mock + web types 🟡 IN PROGRESS
**Done:** `apps/web/src/types/api.ts` — added `PaginatedResponse` import; reshaped `BuyerApplication`
(dropped taxId/phone, added `hasTaxId`/`hasPhone`); added `ApplicationPii`, `BuyerDetail`,
`VolumeBreakBracket`, `PricingTierConditions`, `PricingOverrideSummary`, `PricingTierDetail`.

**Remaining (finish this first):**
1. `apps/web/src/lib/dev/mock-data.ts` — restructure `DEMO_APPLICATIONS` (it currently still has
   taxId/phone and lacks hasTaxId/hasPhone → **compile error now**). Keep full seed (with taxId/phone)
   in a local array; export `DEMO_APPLICATIONS: BuyerApplication[]` (map → hasTaxId/hasPhone, no PII)
   + export a PII lookup `Record<string, ApplicationPii>` for reveal. Optionally add a
   BuyerSummary→BuyerDetail derivation (pricingTierId via tier-name lookup; synth businessType/notes/
   approvedAt).
2. `apps/web/src/lib/dev/mock-api.ts` — add handlers: `GET /buyers/:buyerId`,
   `POST /buyers/:buyerId/reinstate`, `PATCH /buyers/:buyerId`, `POST /buyers/applications/:id/reveal`,
   `GET/POST/PATCH/DELETE /api/v1/pricing-tiers[/:id][/overrides...]`. Match the DTO envelopes above.
   Mutating the in-memory fixtures (push/splice/mutate) is preferred so the demo is convincing
   (existing approve/reject/suspend just return `undefined`). Keep `notFound()` fallback.

---

## WHAT IS NOT YET DONE (Group 1 remaining, priority order)

1. **Finish Task 3 mock** (above) — required for demo-mode parity.
2. **Task 7 — Buyers frontend** (do early; clears the BuyerApprovalPanel break, see Blockers):
   tabs All/Pending/Approved/Suspended + counts, filter bar (status/tier/date), Copy-link+toast,
   Reinstate, View (read-only), row-click panel, Decision-tab Notes, approved inline-edit
   (tier/terms/credit), **PII reveal → confirm dialog + reveal endpoint**. Extend `useBuyers.ts`
   (add reinstate/update/detail/reveal hooks). Files: `app/(merchant)/buyers/page.tsx`,
   `components/merchant/BuyerApprovalPanel.tsx`, `components/merchant/PiiField.tsx`.
3. **Task 6 — Pricing frontend:** empty-state CTA; `PricingTierModal` (new — create+edit, 3 types,
   volume-bracket builder + validation, default checkbox, toasts); tier **cards** (Edit/View buyers/
   Manage overrides/Delete + buyer-count guard + ConfirmDialog); **`pricing/[id]/page.tsx`** (new —
   override table, add-override form, CSV import preview modal, delete-override confirm). Extend
   `usePricingTiers.ts` (create/update/delete/detail/overrides). Reuse `CreatePricingTierSchema`/
   `UpdatePricingTierSchema`/`BulkPricingOverrideSchema` from `@b2b/shared/schemas`.
4. **Task 4 — Nav/shell:** `MerchantNav.tsx` add Analytics+Settings items; new `MerchantTopbar.tsx`
   (avatar dropdown: name/email, Settings, Billing, Sign out). Ensure no link 404s (placeholder route
   files OK). Merchant layout: `app/(merchant)/layout.tsx`.
5. **Task 5 — Dashboard:** welcome/empty-state, Get-Started checklist (create tier/approve buyer/
   subscribe), trial banner (→`/settings/billing`), Recent Invoices table, Pending Applications panel.
   File: `app/(merchant)/dashboard/page.tsx`.
6. **Task 8 — Verify Group 1:** `pnpm typecheck` (6/6), `pnpm --filter=@b2b/api test:unit --testPathPattern=pricing`, `pnpm --filter=@b2b/web build`, demo click-through.

Groups 2–4 (orders/invoices depth; buyer ordering+BNPL+account; analytics/settings/billing/team/
error-gates/emails) remain after Group 1 — see SESSION6 §5.

---

## KNOWN ISSUES / BLOCKERS

- **Web typecheck currently RED (expected, mid-Task-3).** Two breaks until Tasks 3+7 land:
  (a) `apps/web/src/lib/dev/mock-data.ts` `DEMO_APPLICATIONS` lacks `hasTaxId`/`hasPhone` and still
  carries taxId/phone; (b) `apps/web/src/components/merchant/BuyerApprovalPanel.tsx` (~L157–158)
  reads `application.taxId`/`.phone` which no longer exist — rework to the reveal flow.
- **API typecheck GREEN.** Full `pnpm typecheck` was 6/6 at session start; will be red until web is fixed.
- **No live DB** — demo mode is the only runtime; keep mock fixtures in lockstep with new endpoints.
- Env/build traps (unchanged): web symlink trap → `rm -rf apps/web/node_modules && pnpm install --offline`;
  `NEXTAUTH_SECRET` must be real base64 and match web↔API; web imports `@b2b/shared/types` +
  `/schemas` subpaths only (barrel is server-poisoned); error codes are inline snake_case literals;
  `.npmrc` → npmmirror; Bash classifier intermittently flaky (retry).

---

## FRONTEND PATTERNS (use as-is)

- `merchantFetch<T>(path,{method,body,signal})` from `@/lib/api/merchant` auto-routes to the demo mock
  when `isDemoEnabled() && isDemoMerchantId(session?.merchantId)`. `ApiRequestOptions`
  (`@/lib/api/core`) = method/body/token/idempotencyKey/signal/headers; 204→undefined.
- Hooks: TanStack Query v5; key factories (`buyerKeys`, `pricingTierKeys`); `useInfiniteQuery` for
  cursor lists; `useMutation` + `qc.invalidateQueries` on success. Existing buyer hooks:
  useBuyers/usePendingApplications/useApproveBuyer/useRejectBuyer/useSuspendBuyer.
- mock-api `mockMerchantRequest<T>(path,options)` routes by url+method; `paginate()` helper;
  PAGE_SIZE=10. mock-data exports DEMO_DASHBOARD/AR_AGING/PRICING_TIERS/BUYERS/APPLICATIONS/ORDERS/
  INVOICES. **Before building any new screen, read the UI primitives you'll use** (Tabs/Sheet/Select/
  Input/Dialog/Table/StatusBadge/ConfirmDialog/CursorPagination/PageHeader) — paths under
  `apps/web/src/components/` (ui/shared); not yet read this session.

---

## IMMEDIATE NEXT STEP

Finish **Task 3**: edit `apps/web/src/lib/dev/mock-data.ts` (restructure DEMO_APPLICATIONS into a
seed + public list + PII lookup; optional BuyerDetail derivation) then add the new buyer + pricing
handlers to `apps/web/src/lib/dev/mock-api.ts`. Then go straight to **Task 7 (buyers frontend)** to
clear the BuyerApprovalPanel break and restore `pnpm --filter=@b2b/web typecheck` green.

---

## SESSION SUMMARY (facts)

- Group 1 backend buyer endpoints (reinstate/update/detail/PII-reveal) implemented; API typecheck green.
- Security fix landed: plaintext taxId/phone removed from the applications list payload; reveal is
  now an audited on-demand endpoint.
- `UpdateBuyerSchema` already existed in shared — consumed, not rebuilt.
- Web `types/api.ts` reshaped: BuyerApplication (hasTaxId/hasPhone), + ApplicationPii, BuyerDetail,
  and pricing detail/override/conditions types.
- Pricing CRUD/detail/override API already exists and is unchanged — frontend must reuse it.
- Demo mock (mock-data.ts + mock-api.ts) NOT yet updated → web typecheck is currently red (expected).
- BuyerApprovalPanel still reads removed PII fields → must move to reveal flow (Task 7).
- Remaining Group 1 order: finish mock → buyers FE → pricing FE → nav/shell → dashboard → verify.
- No commits past `53fc4ad`; all web work untracked under `apps/web/src/`.
- Keep Decimal/Serializable/audit/RLS/auth-separation/cursor/design-system invariants on every change.
