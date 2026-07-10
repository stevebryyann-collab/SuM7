# Production-Readiness Audit Checklist — Wholesale Portal

> Operational checklist derived from the FINAL PRODUCTION READINESS AUDIT brief, grounded in
> the actual repository at `/root/wholesale-portal` (branch `feat/paddle-migration`).
> Every item cites a real file. Status legend: `[ ]` = verify, `[x]` = verified OK in code,
> `[!]` = **finding** (present but risky / missing).
> Severity: **BLOCKER** · **HIGH** · **MED** · **LOW** · **INFO**.
>
> **Method note:** Sections 3 (Shopify) and 6 (Billing) were produced by dedicated deep-dive
> auditors. Sections 1,2,4,5,7–12 were audited inline against the source. Where a claim needs
> a runtime check (load test, live Shopify review), it is marked "verify at runtime".

---

## How to use this checklist

1. Walk each of the 12 sections; confirm each `[x]` still holds and resolve every `[!]`.
2. No `[!]` marked BLOCKER may remain open at launch.
3. Fill in the **Final Output** artifacts (score, launch decision) after the walk.

---

## 1. Architecture Review

**State:** Clean pnpm/turbo monorepo (`apps/web` Next 14, `apps/api` NestJS 10, `packages/shared`, `packages/database`). Backend hardening at bootstrap is strong. The one structural problem is that **workers and cron jobs run inside the API process**, which couples latency and breaks horizontal scaling.

- [!] **HIGH — Workers run in the API process, not a separate deployment.** `WorkersModule` is imported by `app.module.ts:104` and the only entrypoint is `node dist/main.js` (`apps/api/package.json:8`). BullMQ workers (PDF render via `@react-pdf`, catalog/buyer sync) share the API event loop → CPU-heavy jobs spike request latency, and workers cannot scale independently of the API. _Fix:_ add a `main.worker.ts` entrypoint + separate Railway service; import `WorkersModule` only there.
  - Anchors: `apps/api/src/app.module.ts`, `apps/api/src/workers/workers.module.ts`, `apps/api/package.json`
- [!] **HIGH — In-process crons double-fire under >1 replica.** `ScheduleModule.forRoot()` (`app.module.ts:100`) runs 5 `@Cron` jobs in every process; no leader election / advisory lock. With multiple API replicas, non-idempotent crons run N times (see §6 payment/standing-order reminders). _Fix:_ pg advisory-lock or a single scheduler replica.
  - Anchors: `apps/api/src/invoices/invoices.service.ts:1116,1132,1203`, `apps/api/src/billing/billing.service.ts:311`, `apps/api/src/standing-orders/standing-orders.service.ts:115`
- [!] **MED — No global exception filter.** No `@Catch`/`APP_FILTER` anywhere; unexpected throws fall back to Nest's default (inconsistent `{code}` envelope) and are **not** auto-captured by Sentry (only manually-instrumented paths are). _Fix:_ add a global exception filter that normalizes the error shape and calls `Sentry.captureException`.
  - Anchors: `apps/api/src/main.ts` (no filter registered)
- [!] **LOW — REST + GraphQL both present.** `apps/api/src/graphql/*` overlaps REST controllers; confirm this is intentional surface, not dead weight (extra attack surface + maintenance).
- [x] **INFO — Bootstrap hardening is production-grade.** helmet strict CSP, HSTS preload (2y), explicit CORS allowlist (never wildcard), `ValidationPipe({whitelist})`, OTel initialized before all imports, `rawBody:true` for webhook HMAC, `trust proxy 1`, 30s graceful shutdown. `apps/api/src/main.ts`
- [ ] Next.js: confirm server/client component split, error/loading boundaries exist per route group (Parts 3–4 added `FadeIn`, error boundaries — spot-check `apps/web/src/app/(merchant)` and `(buyer)`).
- [ ] Verify no request-path work is synchronous/blocking (PDF gen must be queue-only, not inline).

## 2. Database & Data-Scale Audit

**State:** Schema is well-modeled (19 models, Decimal money, cursor columns). RLS design is excellent. The scale risks are pooling correctness, hot-row contention under Serializable, and a partly-manual migration story.

- [!] **HIGH — Non-transactional RLS is unreliable under PgBouncer transaction pooling.** `PrismaService.$use` middleware issues a plain `SET app.current_merchant_id` (NOT `SET LOCAL`) as a _separate_ statement (`prisma.service.ts:96-107`). Under Supabase pooler port 6543 (`pgbouncer=true`, transaction mode) the `SET` and the query may land on different backend connections, and a session-level `SET` can bleed to the next tenant reusing that pooled connection unless `server_reset_query=DISCARD ALL`. The code comment acknowledges this and steers writes to `withTenantTransaction` (`SET LOCAL`), but **read paths using the middleware degrade to app-layer-only isolation** (or fail closed). _Fix:_ route all tenant reads through `withTenantTransaction`, or set the GUC via `set_config(...,true)` in the same statement, and confirm pooler reset query.
  - Anchors: `apps/api/src/prisma/prisma.service.ts:75-107`
- [!] **MED — `statement_timeout`/`idle_in_transaction_timeout` set once in `onModuleInit` don't cover the pool.** `SET statement_timeout` runs on one connection at boot (`prisma.service.ts:53-57`); under transaction pooling it is not applied to every backend. _Fix:_ put timeouts in the connection string `options` or `ALTER ROLE ... SET`.
- [!] **MED — Serializable hot-row contention at scale.** Every invoice mark-paid for a merchant contends on the same `merchants` row + `merchant_monthly_gmv` ledger row under Serializable (see §6). Correct, but a 40001 retry storm at high concurrency. _Fix:_ shard the GMV counter or move accrual to an append-only event + async fold.
- [!] **MED — Migration strategy is partly manual; Prisma migrate does not own the RLS/trigger SQL.** RLS, audit-immutability trigger, `invoice_number_seq`, and trigram index live in hand-numbered SQL (`packages/database/migrations/001..014`) applied via the Supabase SQL editor per CLAUDE.md, separate from `prisma migrate`. Drift risk + no automated rollback. _Fix:_ fold SQL into Prisma migrations (or a gated `migrate deploy` step) so schema and policy ship together.
- [ ] **Index coverage — verify at runtime with `EXPLAIN`.** Confirm composite indexes exist for the hot paths at 100M orders: `orders(merchant_id, status, created_at)`, `orders(merchant_id, buyer_id)`, `invoices(merchant_id, status, due_date)`, cursor columns, and the GIN trigram on `buyers.company_name` (documented in CLAUDE.md). Grep `@@index`/`@@unique` in `packages/database/prisma/schema.prisma`.
- [ ] **N+1 — verify at runtime.** Spot-check `catalog.service.ts`, `dashboard.service.ts`, buyer/order list endpoints for `include` fan-out inside loops; confirm cursor pagination (`take`+`cursor`) everywhere, never `skip`/`offset`.
- [x] **INFO — Tenant tables carry RLS with `FORCE ROW LEVEL SECURITY` + fail-closed GUC.** 13 tables enabled; login role is `NOBYPASSRLS`; unset GUC → NULL → matches no row. `packages/database/migrations/003_rls.sql`
- [ ] Confirm `pgbouncer=true&connection_limit=5` per instance is sized for the target replica count (5 × replicas ≤ Supabase pool ceiling).

## 3. Shopify App-Store Readiness

**State (from deep-dive auditor):** Webhook layer is genuinely strong; the install _lifecycle_ and _embedded_ story block submission.

- [!] **BLOCKER — Reinstall never reactivates the merchant.** The upsert `update:` branch only rewrites the encrypted token; it never resets `isActive:true`/`deletedAt:null`. After any uninstall (`merchant-cleanup.worker.ts:120-123` sets `isActive:false`), a reinstall leaves the merchant inactive → `MerchantSessionGuard` throws `MERCHANT_INACTIVE` (locked out) and `WebhookHmacGuard` rejects every business webhook. Uninstall→reinstall is a standard reviewer test. _Fix:_ reactivate in the `update:` branch.
  - Anchors: `apps/api/src/merchants/merchants.service.ts:302-305`, `apps/api/src/workers/merchant-cleanup.worker.ts:120-123`, `apps/api/src/auth/guards/merchant-session.guard.ts:115`, `apps/api/src/webhooks/webhook-hmac.guard.ts:90-101`
- [!] **BLOCKER (data loss) — 90-day purge job not cancelled on reinstall.** `app/uninstalled` enqueues `JOB_MERCHANT_PURGE_DATA` with a 90-day delay; the reinstall path never removes it nor re-checks `isActive` at purge time. A merchant reinstalling within 90 days is later purged. _Fix:_ remove the delayed job on reinstall or re-check `isActive`/`deletedAt` at the top of the purge worker.
  - Anchors: `apps/api/src/workers/merchant-cleanup.worker.ts:138-142`, `apps/api/src/workers/merchant-purge-data.worker.ts`
- [!] **HIGH — `embedded=true` but no App Bridge and `SameSite=Strict` cookies.** `shopify.app.toml:25` declares embedded; no `@shopify/app-bridge` in `apps/web/package.json`; `auth-options.ts:161` sets `sameSite:"strict"`. Inside the `admin.shopify.com` iframe the app origin is third-party, so the session cookie is not sent, and `next.config.mjs` emits no `frame-ancestors` CSP to permit the iframe. Embedded review fails. _Fix:_ add App Bridge session-token auth (or set `embedded=false`) and a `frame-ancestors` header.
- [!] **HIGH — Admin API pinned to `2024-07` (stale).** `shopify-api.service.ts:22` + `shopify.app.toml:46` are ~2 years old at the audit date, past Shopify's ~12-month support window. _Fix:_ bump to a supported version and retest webhooks.
- [!] **MED — App-Proxy HMAC has no replay window and mis-joins repeated params.** `middleware.ts:104-136` ignores the Shopify `timestamp` (captured signed URL replayable to re-mint the 24h `__merchant_ctx` cookie) and doesn't comma-join repeated query params per Shopify's algorithm (array params fail verification). _Fix:_ bound the timestamp; comma-join repeated keys.
- [!] **MED — No reconciler for `webhook_events` stuck in `pending`.** Row is committed before `queue.add()`; if the queue add fails, the event is `pending` forever and Shopify redelivery dedups via P2002 so it never processes. _Fix:_ transactional outbox or a stuck-pending sweeper. `apps/api/src/webhooks/webhooks.controller.ts:269`
- [!] **LOW — Blank `X-Shopify-Webhook-Id` collapses to one dedup key.** Missing header defaults `shopifyEventId` to `""`; a second distinct blank-id event collides on `unique([domain,""])` and is dropped. Fall back to a payload hash. `webhooks.controller.ts:231-233`
- [!] **LOW — `SHOPIFY_SCOPES`/`SHOPIFY_APP_URL` not validated at boot; scopes live in 3 places.** Drift causes silent re-consent loops. Add to `env.validation.ts`, single source of truth.
- [x] **INFO — Mandatory GDPR webhooks present + verified inline.** `customers/data_request`, `customers/redact`, `shop/redact` via constant-time HMAC dispatcher, correctly not behind `WebhookHmacGuard`. `apps/api/src/webhooks/compliance-webhooks.controller.ts`, `shopify.app.toml:104-107`
- [x] **INFO — 10× duplicate delivery is safe.** `unique([shopifyDomain, shopifyEventId])` + P2002-catch → ack-without-reenqueue; workers add a second idempotency layer. `webhooks.controller.ts:242-267`
- [x] **INFO — OAuth uses PKCE + state; shop domain SSRF-validated before URL interpolation.** `shopify-provider.ts:82`, `normalizeShopDomain`
- [ ] Verify token storage is encrypted at rest (AES-256-GCM key versioning) and rotation on reinstall — confirm `EncryptionService` wraps `shopifyAccessToken`.

## 4. Multi-Tenancy Security Audit

**State:** Two-layer model is real and well-built. The residual risks are (a) the pooling caveat from §2 that can disable the RLS layer on reads, and (b) five app-layer-only tables.

- [!] **HIGH — RLS layer may be inactive on non-transactional reads (see §2).** When RLS silently degrades under transaction pooling, isolation rests entirely on app-layer `where:{merchantId}`. That layer looks solid (invoices 70×, orders 46× `merchantId` refs) but is now single-point. _Fix:_ same as §2 — force tenant reads through `withTenantTransaction`.
- [!] **MED — Five tenant-owned tables have NO RLS; isolation is app-layer only.** `shopping_lists`, `shopping_list_items`, `standing_orders` (documented, buyer-portal runs without tenant context), plus `b2b_discount_codes` and `idempotency_keys` carry no policy. App-layer scoping is present (`shopping-lists.service.ts` 17×, `standing-orders.service.ts` 8×, `discount-codes.service.ts` 12× `merchantId`), but any future query that forgets the filter leaks with no DB backstop. _Verify:_ audit every read/write in those services includes `merchantId`; consider a buyer-scoped RLS policy keyed on a `buyer_id` GUC.
  - Anchors: `packages/database/migrations/003_rls.sql` (absent), `apps/api/src/shopping-lists/shopping-lists.service.ts`, `apps/api/src/standing-orders/standing-orders.service.ts`, `apps/api/src/discount-codes/discount-codes.service.ts`
- [!] **LOW — Manual `SET LOCAL app.current_merchant_id = '${...}'` bypasses `quoteMerchantId` validation in two spots.** `pricing-tiers.controller.ts:553`, `resolve.adapter.ts:268` interpolate directly (values are internal UUIDs, low risk) instead of the validated `PrismaService.setGuc` path. _Fix:_ funnel through `withTenantTransaction`/`runAsSystem`.
- [ ] **IDOR sweep — verify at runtime.** Assume an attacker holds another merchant's UUID. Walk every controller that accepts an id (`invoices`, `orders`, `pricing-tiers`, `buyers`, `shopping-lists`, `standing-orders`, `discount-codes`) and confirm the service `where` includes `merchantId` (or runs under an active RLS context). Try fetching a cross-tenant invoice/order id and confirm 404/forbidden.
- [x] **INFO — `MerchantContextService` (AsyncLocalStorage) + `TenantContextInterceptor` set/clear tenant scope per request; system paths use `runAsSystem` bypass.** `app.module.ts:133`, `prisma/merchant-context.service.ts`
- [x] **INFO — `buyers` is intentionally cross-merchant (unified account); per-merchant config lives in `merchant_buyer_relationships` (RLS'd).** Confirm no buyer PII is returned without a relationship check (the Clerk buyer guard enforces this).

## 5. Authentication & Authorization

**State:** Guards match the CLAUDE.md contract precisely; RBAC covers sensitive controllers. Main gaps are webhook-signature parity (Paddle) and the embedded-cookie problem (§3).

- [x] **INFO — Merchant guard verifies HS256 NextAuth JWT against `NEXTAUTH_SECRET`, extracts `merchantId/role/shopifyDomain/userId`, checks merchant active.** Codes `MISSING_TOKEN`/`INVALID_TOKEN`/`MERCHANT_INACTIVE`. `apps/api/src/auth/guards/merchant-session.guard.ts:91-122`
- [x] **INFO — Clerk buyer guard verifies token, loads `merchant_buyer_relationships` by `merchantId + buyer.clerkUserId`, enforces suspended/not-approved/anonymized.** Exactly per spec. `apps/api/src/auth/guards/clerk-buyer.guard.ts:75-113`
- [x] **INFO — `RolesGuard` applied on settings/team/orders/invoices/pricing/analytics/buyers controllers.** RBAC present.
- [!] **HIGH — Embedded session cookie is `SameSite=Strict` (see §3).** Breaks merchant auth inside the Shopify Admin iframe. `auth-options.ts:161`
- [!] **MED — Paddle & Resolve webhook signature verification not yet parity-checked with Shopify.** Confirm each verifies before any processing (Shopify/Clerk-Svix verified; §6 flags Paddle lacks event-id dedup). `apps/api/src/billing/billing.controller.ts:151-184`, `apps/api/src/bnpl`
- [ ] Verify JWT sliding-window renewal (extend if within 24h of expiry) and 7-day max per CLAUDE.md; confirm `__Secure-` cookie prefix + `httpOnly`+`Secure` in prod. `apps/web/src/lib/auth/auth-options.ts`
- [ ] Confirm no role is ever read from client-controlled input (role must come only from the verified JWT / DB).
- [ ] Confirm `sales-rep-session.guard.ts` and `internal-secret.guard.ts` (min 32-char `INTERNAL_API_SECRET`) gate their routes; internal `/internal/*` never reachable externally.

## 6. Billing & Money-Flow Audit

**State (from deep-dive auditor):** Paddle cutover is clean (Decimal.js ROUND_HALF_EVEN, per-tier thresholds, a robust atomic GMV compare-and-set latch, immutable monthly ledger). Material weaknesses: no Paddle webhook dedup, invoice mutations at READ COMMITTED, and no refunds path.

- [!] **HIGH — Paddle webhook has no event-id dedup / replay-age / ordering guard.** `billing.controller.ts:151-184` verifies signature then calls `handleWebhook` directly — no persisted event row (contrast Shopify's `webhook_events` unique). A stale out-of-order `subscription.updated` can wrongly flip `merchant.isActive`; every redelivery writes a duplicate audit row. Only `onTransactionPaymentFailed` is redelivery-safe. _Fix:_ persist + dedup Paddle events by id; guard on `occurred_at`.
- [!] **HIGH — Invoice mutations run at READ COMMITTED, not Serializable (CLAUDE.md violation).** `withTenantTransaction` sets no `isolationLevel` (`prisma.service.ts:123`). `markAsPaid` is saved by an explicit `SELECT … FOR UPDATE`, but `voidInvoice` (`invoices.service.ts:523-568`) has no row lock → two concurrent voids both pass the status check and write two audit rows. Worker paths _do_ set Serializable — inconsistent. _Fix:_ set `isolationLevel:'Serializable'` in `withTenantTransaction` (or lock in `voidInvoice`).
- [!] **MED — No refund / chargeback / adjustment handling.** `handleWebhook` covers only subscription + transaction-paid/failed. A Paddle refund/dispute never reverses GMV, buyer credit, or active status; a paid invoice can't be un-paid. _Fix:_ add `transaction.updated(refunded)` / `adjustment.created` / dispute branches with reversing entries.
- [!] **MED — Dunning failure counter on LRU-evictable cache Redis.** `billing.service.ts:665-675` tracks failures in `REDIS_CACHE` (allkeys-lru); eviction can prevent the 3-strike suspension. _Fix:_ move to persistent (AOF/queue) Redis or Postgres.
- [!] **MED — Cron double-send (ties to §1).** `sendPaymentReminders` (`invoices.service.ts:1132-1201`) does non-atomic findMany→email→bump; two replicas both email the buyer. _Fix:_ advisory lock or atomic claim.
- [!] **MED — Two payment paths can double-count GMV.** `invoice-mark-paid.worker.ts:97-133` sets `amountPaid=total` and adds the FULL total to GMV without reading prior `amountPaid`; a prior manual partial `markAsPaid` then double-counts. _Fix:_ reconcile on a delta in both paths.
- [!] **MED — Audit-log writes on financial changes are best-effort (swallowed).** `writeAudit` wraps `auditLog.create` in try/catch even inside the tx (`invoices.service.ts:1654-1682`); a paid/voided/gmv-charged change can commit with no audit row. _Fix:_ write audit inside the same tx and let failure roll back.
- [!] **LOW — Overpayments silently clamped to invoice total** (`markAsPaid` `Money.min`), excess neither recorded nor surfaced. _Fix:_ record/flag the excess.
- [x] **INFO — GMV metering math is Decimal.js with per-tier free thresholds + rates; no native float.** `billing.service.ts:26-43,404-417`
- [x] **INFO — GMV one-time charge cannot double-bill:** atomic `updateMany WHERE chargedAt IS NULL` latch before the Paddle call; breaker-open releases, ambiguous timeout keeps + Sentry-flags. `billing.service.ts:425-495`, `migration 014`
- [x] **INFO — Closed-month GMV safe from cron/rollover race** via immutable `merchant_monthly_gmv` ledger. `migration 014`, `invoice-mark-paid.worker.ts:129-133`
- [x] **INFO — No live Stripe code remains** (only the rename doc in `013_paddle_migration.sql`); full `PADDLE_*` env set validated.

## 7. Performance & Reliability

**State:** Circuit breakers + BullMQ retries are configured well; the reliability gaps are worker/API coupling (§1), cache-as-source-of-truth (§6), and no dead-letter/alerting on exhausted jobs.

- [x] **INFO — BullMQ defaults: `attempts:5`, exponential backoff 2s, `removeOnComplete{count:500,age:1d}`, `removeOnFail{count:2000}`.** Sensible retry + retention. `apps/api/src/queues/queue.module.ts:48-51`
- [x] **INFO — Circuit breakers wrap Shopify, Resolve/BNPL, S3 storage, billing (Paddle), email (Resend).** `common/circuit-breaker/*`, per-module wiring.
- [!] **HIGH — No dead-letter queue / alert on exhausted (`removeOnFail`) jobs.** After 5 attempts a financial job (invoice generate, mark-paid) is dropped into `removeOnFail` retention with no DLQ or paging. _Fix:_ add a failed-job listener → Sentry/alert + DLQ for manual replay. `apps/api/src/queues/queue.module.ts`, `apps/api/src/workers/*`
- [!] **MED — Confirm Clerk & Paddle calls are breaker-wrapped.** Breakers found for Shopify/Resolve/S3/billing/email; verify Clerk `verifyToken` and every Paddle SDK call also go through a breaker (CLAUDE.md: "no raw fetch to external services").
- [!] **MED — Cache invalidation strategy unproven.** Confirm `catalog.service.ts` (and any cached read) invalidates on the corresponding write / Shopify `products/update` webhook, and that keys are merchant-scoped (no cross-tenant cache bleed).
- [ ] **Verify at runtime — load tests exist; run them.** `tests/load/{catalog,invoice-download,order-creation}.k6.js`. Establish p95 latency + error-rate SLOs and a saturation point.
- [ ] Confirm queue-depth / worker-liveness monitoring is wired to alerts, not just the dashboard. `apps/api/src/queues/queue-health.service.ts`, `queue-health.controller.ts`
- [ ] Confirm large payloads (order CSV import, bulk catalog) are streamed/bounded, and PDF generation is queue-only (never in the request path — ties to §1).

## 8. Security Hardening (OWASP)

**State:** Backend is well-hardened; the frontend ships with no security headers, and raw-SQL GUC-setting is the main injection-shaped surface (mitigated by UUID validation).

- [!] **HIGH — `next.config.mjs` sets no security headers.** No `async headers()` → the web app ships with no CSP, `X-Frame-Options`/`frame-ancestors`, HSTS, or `X-Content-Type-Options`. Compounds the embedded-app blocker (§3) and leaves buyer/merchant pages under-protected. _Fix:_ add a `headers()` block (CSP with `frame-ancestors https://admin.shopify.com https://*.myshopify.com`, HSTS, nosniff, referrer-policy).
  - Anchor: `apps/web/next.config.mjs`
- [!] **MED — `$executeRawUnsafe` used to set the RLS GUC; two call sites skip validation.** `PrismaService.setGuc` validates via `quoteMerchantId` (regex UUID), but `pricing-tiers.controller.ts:553` and `resolve.adapter.ts:268` interpolate `merchantId` directly. Values are internal, so exploitability is low, but it's an injection-shaped pattern. _Fix:_ central validated path only.
  - Anchor: `apps/api/src/prisma/prisma.service.ts:18-24,96-107`
- [!] **MED — SSRF surface: verify tracking URLs / any server-side fetch of merchant-supplied URLs.** `orders.tracking_url` and image handling should never be fetched server-side without an allowlist. Confirm no server-side `fetch` of user-supplied URLs. (OAuth shop-domain SSRF is already closed — §3.)
- [x] **INFO — Backend headers strong:** helmet strict CSP (`default-src 'none'`), HSTS preload, COOP/COEP, referrer-policy, explicit Permissions-Policy; CORS is an explicit allowlist. `apps/api/src/main.ts`
- [x] **INFO — Secrets/PII masked in logs:** deep recursive mask (exact keys + `token|secret|key|auth|credential` pattern), cycle-guarded, depth-bounded. `packages/shared/src/utils/logger.ts:30-107`
- [x] **INFO — S3: private ACL, SSE-KMS with KMS key, path-traversal-safe keys, 1h presigned URLs; uploads are server-generated PDFs (not user uploads).** `apps/api/src/storage/storage.service.ts:77-101`
- [x] **INFO — `ValidationPipe({whitelist})` global; per-IP + per-merchant rate limiting via global `RateLimitGuard`; webhooks exempted.** `app.module.ts:131`, `common/guards/rate-limit.guard.ts`
- [ ] **Verify at runtime — dependency vulnerabilities.** Run `pnpm audit` / CI `security` job output; confirm no criticals in the locked stack.
- [ ] Confirm no XSS: grep `dangerouslySetInnerHTML` in `apps/web/src` (invoice/PDF HTML, rich text) and confirm sanitization.
- [ ] Confirm error responses never leak stack traces / internals in prod (ties to the missing global exception filter, §1).
- [ ] Confirm S3 presigned TTL (1h) is acceptable for invoice links; consider shorter + per-download authz.

## 9. Observability

**State:** The building blocks are present (Sentry, OTel, pino, correlation middleware, health endpoints), but uncaught errors aren't auto-captured and worker/correlation propagation needs confirming.

- [x] **INFO — Sentry initialized before request handling** (`main.ts:46-53`, traces/profiles 0.1); manual `captureException` in orders/billing/buyers/redis hot paths.
- [x] **INFO — OTel initialized before all imports (auto-instruments http/express/pg/ioredis), OTLP → Grafana; correlation middleware present.** `apps/api/src/tracing/tracing.ts`, `tracing/correlation.middleware.ts`
- [x] **INFO — Structured pino logging with correlationId mixin (AsyncLocalStorage) + PII masking.** `packages/shared/src/utils/logger.ts`
- [!] **MED — Uncaught exceptions not auto-reported (no global exception filter / `@sentry/nestjs`).** Only manually-instrumented paths reach Sentry; a throw in an un-instrumented controller/handler is invisible. _Fix:_ global filter with `Sentry.captureException` (also §1).
- [!] **MED — Confirm correlationId propagates request → BullMQ job → external call.** Verify workers run inside `runWithCorrelationId` (job data carries the id) so a 3AM trace spans the async hop. `apps/api/src/workers/*`, `worker-helpers.ts`
- [ ] Confirm alerting rules exist (Better Stack / Grafana) for: error-rate spike, queue depth, failed jobs, circuit-breaker open, webhook `pending` backlog, dunning suspensions.
- [ ] Confirm `/health` + `/settings/health` (system-health) expose DB, both Redis instances, queue depth, and breaker states; used by deploy readiness. `apps/api/src/health/*`

## 10. Deployment & DevOps

**State:** CI is a real 8-stage pipeline, but there is no automated deploy/migration stage and rollback is manual.

- [x] **INFO — CI is 8 stages:** `install → lint → typecheck → test → build → e2e → lighthouse → security`; `build` gated on `[lint,typecheck,test]`. `.github/workflows/ci.yml`
- [!] **HIGH — No automated deploy / `prisma migrate deploy` / rollback in CI.** Pipeline stops at build/test; migrations (incl. hand-applied RLS SQL, §2) are manual via Supabase SQL editor. No zero-downtime migration gating, no automated rollback. _Fix:_ add a gated `migrate deploy` + deploy job; document forward-only + backfill strategy; script rollback.
- [!] **HIGH — Workers not a separate deployable (see §1).** Railway "API only" per CLAUDE.md, but workers are in-process → no independent worker scaling; no Procfile/`railway.*`/`nixpacks.toml` splitting them. _Fix:_ separate service + entrypoint.
- [!] **MED — CI injects a fallback `NEXTAUTH_SECRET` placeholder for builds.** Fine only if deploy always overrides; confirm prod never ships the placeholder. `.github/workflows/ci.yml:96`
- [ ] Confirm Supabase automated backups + PITR enabled; test a restore. Document RPO/RTO in `docs/runbooks/disaster-recovery.md`.
- [ ] Confirm health checks gate Railway/Vercel deploys; confirm Vercel env var parity with `env.validation.ts` and `.env.example`.
- [ ] Confirm rollback runbook is executable (not just prose) — `docs/runbooks/`, `docs/deployment-checklist.md`.

## 11. Testing

**State:** Only 4 backend unit specs exist; the highest-value financial/tenancy/webhook paths are largely untested.

- [x] **INFO — Present:** unit `pricing.service.spec`, `billing.service.spec`, `compliance-webhooks.controller.spec`, `gdpr-compliance.worker.spec`; e2e `auth/buyer/merchant/visual-consistency`; load `catalog/invoice-download/order-creation`.
- [!] **HIGH — Critical missing tests.** Add before launch:
  - [ ] Order creation: Serializable transaction + Decimal pricing/volume-break correctness under concurrency. `orders.service.ts`
  - [ ] Invoice lifecycle: generate → mark-paid (partial/full/over) → void; concurrent mark-paid idempotency; GMV double-count guard (§6).
  - [ ] Multi-tenant isolation: cross-merchant IDOR attempts return 404/forbidden **with RLS active and with app-layer only** (proves both layers).
  - [ ] Guards: merchant JWT (expired/invalid/inactive), Clerk buyer (no-relationship/suspended/unapproved/anonymized), internal-secret.
  - [ ] Webhook idempotency: Shopify 10× replay (one job) and Paddle replay/out-of-order (currently unguarded — §6).
  - [ ] Paddle billing: GMV threshold math per tier, one-time-charge latch, dunning 3-strike.
  - [ ] BNPL: `ResolveAdapter` breaker-open + webhook HMAC.
- [ ] Add a production smoke checklist (run post-deploy): merchant OAuth install, buyer registration+approval, catalog browse, order create, invoice PDF download, payment status, BNPL, each webhook topic, monthly GMV overage.

## 12. Code Quality

**State:** Unusually clean — this reads like a maintained codebase, not a prototype.

- [x] **INFO — Debt sweep is near-empty:** 3 `TODO/FIXME` (all benign format-comment/placeholders), 0 `@ts-ignore`, 0 `console.log` in runtime src, 0 stub throwers.
- [x] **INFO — Dev-only mock backend is correctly gated.** `mock-api.ts` is reached only when `isDemoEnabled()` (`NODE_ENV !== 'production'`, statically dead-code-eliminated in prod) AND the session is the sentinel demo merchant id. Not a production path — **not a blocker**. `apps/web/src/lib/dev/demo.ts`, `apps/web/src/lib/api/merchant.ts:24`
- [!] **LOW — `: any` in orders business logic.** `discountCodesService?: any`, `inventoryService?: any` injected to dodge circular DI (`orders.service.ts:185-186`); plus `catch (error: any)` in `shopping-lists.service.ts:43,188`. Violates CLAUDE.md "zero any in business logic". _Fix:_ type the optional deps via interfaces.
- [!] **LOW — 17 `eslint-disable` in runtime src.** Confirm each is justified, not silencing a real issue.

---

# FINAL OUTPUT

## 1. Production-Readiness Score

**62 / 100** (preliminary — based on inline audit of 10 dimensions + deep-dives on Shopify & Billing).

Rationale: exceptionally strong foundations (RLS design, webhook HMAC + idempotency, PII masking, circuit breakers, Decimal money, GMV idempotency latch, backend hardening, code hygiene) pulled down by a small set of real, launch-blocking defects in the Shopify install lifecycle, billing correctness, and tenancy-under-pooling. This is a "good build with sharp edges," not a prototype.

## 2. Critical Blockers

```
Severity: BLOCKER
Issue:    Reinstall never reactivates the merchant (stays isActive:false)
Location: apps/api/src/merchants/merchants.service.ts:302-305 (+ merchant-cleanup.worker.ts:120-123)
Risk:     Standard uninstall→reinstall review test locks the merchant out; all business webhooks rejected. App Store rejection + churn.
Fix:      In the upsert update: branch, reset isActive:true, deletedAt:null.

Severity: BLOCKER
Issue:    90-day merchant-purge job not cancelled on reinstall (data loss)
Location: apps/api/src/workers/merchant-cleanup.worker.ts:138-142; merchant-purge-data.worker.ts
Risk:     Merchant who reinstalls within 90 days has all data purged when the delayed job fires.
Fix:      Remove the delayed job on reinstall, or re-check isActive/deletedAt at purge time.

Severity: BLOCKER (Shopify App Store)
Issue:    embedded=true with no App Bridge + SameSite=Strict cookie + no frame-ancestors CSP
Location: shopify.app.toml:25; apps/web/src/lib/auth/auth-options.ts:161; apps/web/next.config.mjs
Risk:     App does not function inside the Shopify Admin iframe → embedded review fails.
Fix:      Add App Bridge session-token auth (or set embedded=false) + frame-ancestors header + adjust cookie for iframe.
```

## 3. High-Priority Improvements

- Paddle webhook: add event-id dedup + replay-age + ordering guard (`billing.controller.ts`).
- Invoice mutations: enforce `isolationLevel:'Serializable'` in `withTenantTransaction`; lock `voidInvoice`.
- RLS under PgBouncer transaction pooling: force tenant reads through `withTenantTransaction` / `set_config(...,true)`; verify pooler `server_reset_query`.
- Split workers + cron scheduler out of the API process; add cron leader election / advisory locks.
- Add automated `migrate deploy` + deploy + rollback to CI; fold RLS/trigger SQL into managed migrations.
- Add `next.config` security headers (CSP/frame-ancestors/HSTS/nosniff).
- Add global exception filter + Sentry auto-capture; confirm correlationId propagates into workers.
- Add DLQ + failed-job alerting for financial queues.
- Bump stale Shopify Admin API version off `2024-07`.
- Backfill critical tests (orders/invoices/tenancy/guards/webhook-idempotency/billing).

## 4. Medium-Priority Improvements

Refund/chargeback handling; move dunning counter off LRU cache Redis; reconcile the two payment paths (GMV double-count); make audit writes transactional/non-swallowed; App-Proxy replay window + param-join fix; `webhook_events` stuck-pending reconciler; validate `SHOPIFY_SCOPES`/`SHOPIFY_APP_URL` at boot; confirm Clerk/Paddle calls are breaker-wrapped; RLS for the 5 app-layer-only tables.

## 5. Performance Improvements

Separate worker fleet; shard/append-fold the GMV hot row to avoid Serializable retry storms; verify composite indexes on `orders`/`invoices` hot paths; prove cache invalidation + merchant-scoped keys; run the k6 suite and set SLOs; ensure PDF/CSV work is queue-only and streamed; put `statement_timeout` in the connection string.

## 6. Security Improvements

Frontend security headers; central validated RLS-GUC path (kill the 2 raw interpolations); SSRF allowlist for any server-side fetch of merchant URLs; no stack traces in prod errors; `pnpm audit` clean; grep/verify `dangerouslySetInnerHTML`; shorten/authz invoice presigned URLs.

## 7. Shopify App Store Readiness

**FAIL (as-is).** Reasons: (1) reinstall lockout, (2) reinstall data-purge, (3) embedded app non-functional in the Admin iframe (no App Bridge, Strict cookie, no frame-ancestors), (4) stale Admin API version. **Strengths that already pass:** all 3 mandatory GDPR/compliance webhooks verified inline, HMAC + 10× idempotency, PKCE+state OAuth with SSRF-safe shop domain. → Becomes a **PASS** once the four items are fixed and re-tested with a real uninstall→reinstall in a dev store.

## 8. Scalability Prediction

- **Current safe scale:** ~low hundreds of merchants (single API+worker process, in-process crons, manual migrations, `connection_limit=5`). Fine for a design-partner / beta cohort.
- **Expected first bottleneck:** the API/worker shared process (PDF/catalog CPU stalling request latency) and cron double-fire the moment a 2nd replica is added.
- **1,000 merchants:** separate worker + scheduler services; fix RLS-under-pooling; Paddle webhook idempotency; cron advisory locks; move dunning/idempotency off cache Redis; automated migrations.
- **10,000 merchants:** add/verify composite + partial indexes on hot tables; read replica for analytics/dashboard; queue concurrency tuning + DLQ; per-tenant rate isolation; GMV counter sharding to kill Serializable contention; connection-pool sizing review.
- **100,000 merchants:** horizontal API + worker fleets; partition `orders`/`invoices`/`audit_log` by merchant (or time); dedicated Postgres / Citus instead of shared Supabase pooler; transactional-outbox for webhooks; multi-region + regional Redis.

## 9. Final Launch Decision

**B) Ready after fixes.**

The architecture is sound and the code quality is high; there is **no** finding that requires a ground-up redesign. But three BLOCKERs (two Shopify-lifecycle, one embedded-app) plus the billing-correctness and RLS-pooling HIGHs must be closed before onboarding real paying merchants. Close the BLOCKERs + §3 HIGHs, separate the worker fleet, and backfill the critical financial/tenancy tests → then launch to a controlled cohort while working the MED list.
