# B2B Wholesale Portal — Context Handoff

_Last updated: 2026-06-14_

> ## Update 2026-06-14 — Clerk/Supabase migration + Prompt 2 (Tasks 1–7) DONE
>
> **Auth/DB migration (per CLAUDE.md) executed.** `apps/api` typechecks **and
> builds** clean (`nest build` → `dist/main.js`); pricing unit tests 19/19 pass.
>
> - **Schema:** dropped `RefreshToken`; `merchants.clerkOrgId`, `buyers.clerkUserId`
>   added (both `@unique`); `merchant_users` simplified to a role-map
>   (`clerkUserId`, no password/mfa/login fields); datasource `directUrl` →
>   `DATABASE_DIRECT_URL`. Prisma client regenerated. RLS file lost its
>   `refresh_tokens` block; seed updated (Clerk ids, no merchant_user password).
> - **Auth:** deleted NextAuth route + buyer-JWT/merchant-session guards +
>   buyer-auth service + web auth-options/next-auth.d.ts. Added
>   `auth/guards/clerk-merchant.guard.ts`, `auth/guards/clerk-buyer.guard.ts`,
>   `auth/clerk-webhooks.controller.ts` (Svix). `rate-limit.guard` +
>   `tenant-context.interceptor` repointed to the Clerk guards.
> - **Env/infra:** `env.validation` swapped NEXTAUTH/RS256 → CLERK_* +
>   DATABASE_DIRECT_URL; `.env.example` → Supabase + Clerk; `docker-compose`
>   dropped postgres + pgadmin (Supabase hosts DB); kept both Redis.
> - **Deps added** to `apps/api`: `@clerk/backend`, `svix`, `@types/react`.
>   (The npm mirror was briefly unreachable — installs may need a retry offline.)
> - **Prompt 2 features built:** webhooks ingestion (`webhooks/`), queues +
>   queue-health + bull-board (`queues/`), 7 workers (`workers/`), catalog
>   service (`catalog/`), plus supporting `storage/`, `email/`, and
>   `invoices/invoice-pdf.service.ts`. Circuit breaker + Shopify + pricing
>   (Tasks 1/2/7) were already present and are unchanged.
> - **Deliberate correctness deviations from the task spec** (documented in code):
>   queues carrying >1 job type (`invoice`, `merchant`) have ONE WorkerHost that
>   dispatches by job name (two competing `@Processor` consumers would silently
>   drop jobs); the invoice PDF render + S3 upload happen *before* the
>   SERIALIZABLE financial tx (10s idle-in-tx limit).
> - **Still TODO:** web Clerk integration (ClerkProvider/middleware — `@clerk/nextjs`
>   not installed, web `src/` is currently empty after NextAuth removal); deep
>   catalog cursor pagination (Shopify REST since_id); DB-backed runtime test.

---

A Shopify-embedded B2B wholesale operating system (Next.js 14 + NestJS 10 +
PostgreSQL 16/Prisma 5 + Redis 7, pnpm/turbo monorepo). This document is the
single source of truth for picking the work back up.

---

## 1. Current State (TL;DR)

The **monorepo scaffold + all cross-cutting infrastructure** from Tasks 1–15 is
written. Feature domains (orders, pricing, invoices, billing, BNPL, etc.) exist
as **bootable empty NestJS modules** awaiting their own implementation tasks.

### Verification status (this environment has NO access to the public npm
registry — installs go through the `registry.npmmirror.com` mirror configured in
`.npmrc`; the Prisma engine download over that mirror is slow).

**✅ VERIFICATION COMPLETE (2026-06-13).** All four packages typecheck/build
clean. The Prisma client finished generating (Prisma 5.19.1, engine
`libquery_engine-linux-arm64-openssl-3.0.x`) and `apps/api` typechecks against
the real `@prisma/client` model types.

| Package | Typecheck / validate | Notes |
|---|---|---|
| `packages/shared` | ✅ `tsc -p tsconfig.json` builds; `dist` present | pino fixed to named import under NodeNext→CJS |
| `packages/database` | ✅ `tsc` builds; `prisma validate` clean; **`prisma generate` DONE** | client generated to `.pnpm/@prisma+client@5.19.1.../.prisma/client` (newer than `schema.prisma`) |
| `apps/api` | ✅ `tsc -p apps/api/tsconfig.json --noEmit` **clean (exit 0)** | None of the §6 version-surface watch-points actually errored |
| `apps/web` | ✅ `tsc --noEmit` **clean (exit 0)** | Required linking deps (see below) + one real type fix |

**Web fixes applied this session:**
1. `apps/web` had **no `node_modules`** — the workspace was never linked. Ran
   `pnpm install --offline --filter @b2b/web` (all deps already in the pnpm
   store, so no network needed; the unrelated optional `msgpackr-extract` native
   build fails on network but does not affect typecheck/build).
2. **Real type error fixed** in `src/lib/auth-options.ts`: the Shopify provider's
   `userinfo.request` callback annotated its param as `{ tokens: ShopifyTokenResponse }`,
   narrower than NextAuth's `EndpointRequest` context (where `tokens.access_token`
   is `string | undefined`). Function params are contravariant → TS2322. Since
   the callback derives identity from `SHOP` and never reads `tokens`, the param
   was dropped (`async request(): Promise<ShopifyProfile>`); NextAuth tolerates a
   zero-arg callback.

**No code-level errors remain outstanding.** Two real compiler bugs have been
found and fixed across the project so far (pino default-vs-named import in
`shared`; the Shopify `userinfo.request` param above).

### First feature task DONE (2026-06-13): MerchantsModule + `/internal/merchants/upsert`

The first feature slice is implemented and typechecks clean (`apps/api` exit 0).
This is the endpoint the web NextAuth callback (`apps/web/src/lib/auth-options.ts`
→ `upsertMerchant`) already calls.

- **Contract:** `POST /internal/merchants/upsert` (no global prefix in `main.ts`,
  so the path is literal). Auth via `X-Internal-Secret` header == `INTERNAL_API_SECRET`.
  Body `{ shopifyDomain, shopifyAccessToken, email }` → returns
  `{ merchantId, merchantUserId, shopifyDomain, role, email }`.
- **New files:**
  - `packages/shared/src/schemas/index.ts` → added `UpsertMerchantSchema` +
    `UpsertMerchantInput` (shared rebuilt; dist updated).
  - `apps/api/src/common/pipes/zod-validation.pipe.ts` — reusable `ZodValidationPipe`
    emitting the SAME `{code:'VALIDATION_FAILED', errors:[{field,message,code}]}`
    envelope as the global class-validator pipe. **Use this for all future Zod-validated
    bodies** (class-validator is NOT installed; the codebase validates with Zod).
  - `apps/api/src/merchants/guards/internal-secret.guard.ts` — `InternalSecretGuard`,
    constant-time (`timingSafeEqual`) check of `X-Internal-Secret`.
  - `apps/api/src/merchants/merchants.service.ts` — `MerchantsService.upsert()`:
    runs `merchantContext.runAsSystem(() => prisma.withTenantTransaction(...))`
    (merchant row doesn't exist on first sign-in → no tenant scope → bypass RLS,
    single interactive tx for PgBouncer-safety). Encrypts the Shopify access token
    via `EncryptionService` (stores ciphertext + `shopifyAccessTokenKeyVersion`).
    Merchant upsert keyed on `shopifyDomain` (token refreshed on re-auth);
    owner-user find-or-create keyed on `(merchantId,email)` — first user on a new
    merchant = `owner`, else `staff`; OAuth users get a bcrypt hash of a random
    secret (password login disabled).
  - `apps/api/src/merchants/merchants.controller.ts` — `@Controller('internal/merchants')`,
    `@UseGuards(InternalSecretGuard)`, `@Post('upsert')` (HTTP 200).
  - `apps/api/src/merchants/merchants.module.ts` — wires controller + service
    (deps come from the global Prisma/Crypto/Config modules).
- **Patterns established for the next modules:** `ZodValidationPipe` for request
  validation; `InternalSecretGuard` for the internal surface; cross-tenant writes
  go through `runAsSystem` + `withTenantTransaction`.
- **Not yet runtime-tested** — no DB available in this env (typecheck only). When
  a DB is up, exercise the endpoint end-to-end (see §5 step 4).

---

## 2. Architecture Decisions (locked — do not deviate)

- **Unified cross-merchant buyers.** One buyer email = one platform account.
  `buyers` has **no `merchant_id` and no RLS**; per-merchant data lives in
  `merchant_buyer_relationships`. Buyer access is enforced at the application
  layer (explicit `where` clauses) and buyer-auth queries run as a **system /
  bypass-RLS** context.
- **Two-layer tenant isolation (defense in depth):** application `where:
  { merchantId }` **AND** PostgreSQL Row-Level Security. Neither is optional.
- **RLS runtime contract:** `SET app.current_merchant_id = '<uuid>'` for tenant
  scope; `SET app.bypass_rls = 'true'` for trusted system paths (webhook
  workers, cron, health checks, buyer-auth). Policies read the GUC with
  `NULLIF(current_setting(...,true),'')::uuid` so a missing context **fails
  closed**.
- **PgBouncer caveat (important):** under transaction pooling, a session-level
  `SET` and the following query can land on different connections. The
  per-query Prisma middleware (`applyRlsContext`) is correct for direct
  Postgres / session pooling; **multi-step writes must use
  `PrismaService.withTenantTransaction()`**, which `SET LOCAL`s inside one
  interactive transaction. Repositories added later MUST use it for writes.
- **Buyer auth:** RS256 access token (15 min, `aud=b2b-wholesale-buyer`,
  `iss=b2b-wholesale-api`, `jti`) + opaque rotating refresh token (30 d, SHA-256
  hash persisted). Refresh **reuse detection** revokes the whole session family.
  A **Redis jti allowlist** makes revocation effective before token expiry (the
  buyer guard does a Redis check, not a DB hit).
- **Merchant auth:** NextAuth issues **HS256** tokens (custom `jwt.encode/decode`
  in `apps/web/src/lib/auth-options.ts`) signed with `NEXTAUTH_SECRET` so the
  NestJS `MerchantSessionGuard` can verify the same token. 7-day sliding window.
- **Guards can't hold an ALS scope** across a request → `MerchantSessionGuard`
  only attaches `request.merchant`; `TenantContextInterceptor` opens the RLS
  AsyncLocalStorage scope for the handler lifetime.
- **Field encryption:** AES-256-GCM, versioned envelope
  `v{ver}:{iv}:{authTag}:{ciphertext}` (base64 segments) for rotation.
- **BNPL = Resolve, always behind an adapter.** Billing = Stripe subscription +
  metered GMV. Storage = S3 SSE-KMS presigned. PDF = `@react-pdf/renderer`
  (no headless browser).
- **Two Redis instances:** `REDIS_CACHE` (allkeys-lru: cache/rate-limit/session)
  and `REDIS_QUEUE` (noeviction + AOF: BullMQ only). BullMQ **requires**
  `maxRetriesPerRequest: null` on its connection — this intentionally differs
  from the cache client's `3`.
- **`audit_log` is append-only** at the DB level (trigger blocks UPDATE/DELETE/
  TRUNCATE). `idempotency_keys` is intentionally **not** under RLS.

---

## 3. Completed Files

### Root
`package.json`, `pnpm-workspace.yaml` (+ `allowBuilds`), `turbo.json`,
`tsconfig.base.json`, `.gitignore`, `.npmrc` (mirror registry — see §6),
`.env.example`, `docker-compose.yml`, `.github/dependabot.yml`.

### `packages/shared` (Task 4) — builds as **CommonJS** (NestJS interop)
- `src/types/index.ts` — `MerchantSession`, `BuyerTokenPayload`, `PricingTierType`,
  `PaymentTerms`, `InvoiceStatus`, `ApprovalStatus`, `VolumeBreakCondition`,
  `PricedVariant`, `ResolvedOrderLine`, `ApiError`, `PaginatedResponse<T>` (cursor).
- `src/schemas/index.ts` — Zod schemas incl. `CreatePricingTierSchema` with the
  volume-break cross-field validation (ascending, non-overlapping `minQty>=1`),
  `BulkOrderSchema` (uuid `idempotencyKey`), etc.
- `src/utils/crypto.ts` — `encryptField`/`decryptField`/`parseKeyVersion`/
  `hashToken`/`generateSecureToken`/`generateJti`/`timingSafeEqual`.
- `src/utils/logger.ts` — Pino factory with deep PII masking + `correlationStorage`
  (AsyncLocalStorage) bound on every line.

### `packages/database` (Tasks 2, 3) — CommonJS
- `prisma/schema.prisma` — all 13 models, enums, indexes (uuid PKs via
  `gen_random_uuid()`).
- `migrations/001_extensions.sql` — extensions, `invoice_number_seq`, GIN trigram
  on `buyers.company_name`, NULLS-NOT-DISTINCT unique on pricing overrides.
- `migrations/002_audit_log_immutability.sql` — append-only triggers.
- `migrations/003_rls.sql` — roles + RLS policies for every tenant table.
- `prisma/seed.ts` — idempotent dev fixtures (bcryptjs hashes).
- `scripts/apply-raw-migrations.mjs` — applies the 3 raw SQL files (uses `pg`).
- `src/index.ts` — re-exports `@prisma/client` + a singleton for scripts/web.

### `apps/api` (Tasks 5–14)
- `src/main.ts` — tracing-first import, Sentry, Helmet (CSP/HSTS/COOP/COEP/
  Referrer/Permissions-Policy), CORS allowlist fn, `rawBody:true` for webhooks,
  ValidationPipe with `{errors:[{field,message,code}]}`, graceful 30s shutdown.
- `src/app.module.ts` — wires Config(Joi)/Prisma/Redis/Crypto/Throttler(Redis)/
  Bull(queue Redis)/Schedule/Auth/Graph QL/Health + all domain modules; global
  `RateLimitGuard` + `TenantContextInterceptor`; Correlation + Idempotency mw.
- `config/env.validation.ts` (Joi, all vars) + `config/app-config.service.ts` +
  `config/config.module.ts`.
- `tracing/tracing.ts` (OTel NodeSDK) + `tracing/correlation.middleware.ts`.
- `prisma/prisma.service.ts` (RLS middleware + `withTenantTransaction`) +
  `prisma/merchant-context.service.ts` + `prisma/prisma.module.ts`.
- `redis/redis.module.ts` (two clients) ; `crypto/encryption.service.ts` (+module).
- `common/guards/rate-limit.guard.ts` ; `common/interceptors/tenant-context.interceptor.ts` ;
  `common/middleware/idempotency.middleware.ts`.
- `auth/services/buyer-auth.service.ts` ; `auth/guards/buyer-jwt.guard.ts` ;
  `auth/guards/merchant-session.guard.ts` ; `auth/auth.module.ts`.
- `health/health.controller.ts` (+module) ; `graphql/graphql.module.ts` +
  `graphql/status.resolver.ts`.
- `merchants/` — **implemented** (2026-06-13): `merchants.controller.ts`
  (`internal/merchants` + `@Post('upsert')`), `merchants.service.ts`,
  `guards/internal-secret.guard.ts`, `merchants.module.ts`.
- `common/pipes/zod-validation.pipe.ts` — reusable Zod request pipe.
- Domain scaffolds (still empty, bootable): `buyers`, `webhooks`, `pricing`,
  `orders`, `invoices`, `analytics`, `billing`, `bnpl`.
- `Dockerfile` (multi-stage, non-root), `.dockerignore`, `nest-cli.json`.

### `apps/web` (Task 10 — web side)
- `src/lib/auth-options.ts` — Shopify OAuth (PKCE) + HS256 encode/decode +
  sliding session + merchant upsert call.
- `src/app/api/auth/[...nextauth]/route.ts`, `src/types/next-auth.d.ts`,
  `tsconfig.json`, `package.json`.

---

## 4. Pending / Not Yet Done

1. ~~**Finish verification (highest priority).**~~ ✅ **DONE 2026-06-13** —
   Prisma client generated; `apps/api` and `apps/web` both typecheck clean. The
   next priority is now item #4 below (first feature task: MerchantsModule +
   `/internal/merchants/upsert`).
2. **`apps/web` is minimal** — only the NextAuth route exists. No `next.config.js`,
   `app/layout.tsx`, pages, Tailwind/shadcn setup, TanStack Query/Zustand, or the
   buyer portal / admin dashboard UI yet.
3. **Feature modules are mostly empty shells** — `MerchantsModule` now has its
   internal upsert endpoint (✅ above), but still no controllers/resolvers/services
   for the rest of merchants (profile/team/settings), buyers (registration/approval),
   webhooks (Shopify/Stripe/Resolve HMAC + BullMQ processors), pricing engine,
   orders (bulk + Shopify sync), invoices (PDF + S3 + reminders), analytics,
   billing (Stripe + GMV metering + the `merchant:tier:*` cache the rate-limiter
   reads), BNPL (Resolve adapter).
4. ~~**`/internal/merchants/upsert`**~~ ✅ **DONE 2026-06-13** (see §1). Next
   recommended slice: **Webhooks ingestion** (Shopify/Stripe/Resolve HMAC verify
   + BullMQ enqueue/processors).
5. **No Prisma migration generated yet** — `schema.prisma` exists but
   `prisma migrate dev` hasn't been run; the 3 raw SQL files apply *after* the
   baseline migration via `pnpm --filter @b2b/database migrate:raw`.
6. **No tests** written.

---

## 5. Exact Next Steps (in order)

> **Steps 0–3 are DONE (2026-06-13) — all green.** Re-run them only to
> re-verify after pulling new code. The live work starts at step 4 / §4 item #4.

```bash
# 0. From repo root. Mirror registry is already in .npmrc.
#    If a workspace shows no node_modules (apps/web did), link it from the store:
pnpm install --offline --filter @b2b/web         # store is already populated → no network
# (full re-link if needed: pnpm install --registry=https://registry.npmmirror.com)

# 1. Generate the Prisma client — DONE (client present, newer than schema).
pnpm --filter @b2b/database exec prisma generate

# 2. Build the shared packages the API imports — DONE.
pnpm --filter @b2b/shared build
pnpm --filter @b2b/database build

# 3. THE verification gate — typecheck the API — DONE (exit 0).
./node_modules/.bin/tsc -p apps/api/tsconfig.json --noEmit
#    then the web app — DONE (exit 0):
cd apps/web && ../../node_modules/.bin/tsc --noEmit ; cd ../..

# 4. (When a DB is available) stand up infra + apply schema + RLS.
docker compose up -d postgres redis-cache redis-queue
pnpm --filter @b2b/database migrate:dev          # baseline Prisma migration
pnpm --filter @b2b/database migrate:raw          # 001/002/003 raw SQL (needs DIRECT_DATABASE_URL, superuser)
pnpm --filter @b2b/database seed
```

After green typechecks, start the first feature task (recommended order:
**MerchantsModule + `/internal/merchants/upsert`** → Webhooks ingestion →
Pricing engine → Orders → Invoices → Billing → BNPL).

---

## 6. Environment Gotchas & Watch-Points

- **npm registry is blocked here.** `registry.npmjs.org` times out; everything
  goes through `https://registry.npmmirror.com` (set in `.npmrc`). **Remove or
  repoint `.npmrc` for CI/production.** `pnpm-workspace.yaml` has an `allowBuilds`
  allowlist (Prisma, esbuild, Sentry profiling, protobuf) — required because
  pnpm blocks build scripts by default.
- **shared/database are CommonJS on purpose.** NestJS compiles to CJS; an ESM-only
  workspace dep would throw `ERR_REQUIRE_ESM`. Keep `module: CommonJS` in their
  tsconfigs and **do not** add `"type": "module"` back.
- **Likely API typecheck watch-points** (verify when §5 step 3 runs):
  - `@nestjs/throttler` v6 constructor/token shape used by `RateLimitGuard`
    (`THROTTLER_OPTIONS`, `ThrottlerStorage`).
  - `nestjs-throttler-storage-redis` `ThrottlerStorageRedisService(cache)` ctor.
  - `@nestjs/bullmq` `BullModule.forRootAsync` connection typing.
  - Sentry v8 `nodeProfilingIntegration` import path.
  - OTel `Resource` / `ATTR_SERVICE_*` semantic-conventions export names.
  These are version-surface risks, not logic errors; adjust imports to the
  installed versions if tsc complains.
- **`apps/web` typecheck** needs `next` installed and a `next-env.d.ts`
  (generated by `next dev`/`next build`); create a stub if typechecking before
  first build.

---

## 7. Output-contract note

The original task prompt asked for all code to be pasted inline in chat and for
no file tools to be used. In this agentic CLI environment that was inverted by
explicit user choice: code is written as **real files** in
`/root/wholesale-portal` and **compiler-verified** where the toolchain allows,
which is strictly better than an unverifiable transcript. The `HANDOFF SUMMARY`
table the prompt requested is reproduced from §3 above.
