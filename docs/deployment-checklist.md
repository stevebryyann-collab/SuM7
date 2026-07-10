# Deployment Checklist — B2B Wholesale Portal

**Audience:** release engineer shipping the platform to staging or production.
**Goal:** a repeatable, financial-grade go-live gate. Every box must be checked — there are no
"skip for now" items on the payments or tenancy path.

Stack is locked in `CLAUDE.md` (PROVIDER MAP). This checklist assumes that map and does not
re-litigate provider choices.

---

## 0. Pre-flight (run locally before touching any environment)

- [ ] `git status` clean on the release commit; tag the release (`vX.Y.Z`).
- [ ] `pnpm install --frozen-lockfile` passes (lockfile is authoritative).
- [ ] `pnpm --filter @b2b/database exec prisma generate` — green.
- [ ] `pnpm typecheck` (full turbo) — **exit 0, zero errors**.
- [ ] `pnpm --filter @b2b/api build` (`nest build`) — exit 0.
- [ ] `pnpm --filter @b2b/web build` (`next build`) — exit 0, all pages collected.
      Requires a **real** base64 `NEXTAUTH_SECRET` (`openssl rand -base64 32`); a malformed
      dummy secret fails page-data collection on `/merchant-login`.
- [ ] `pnpm --filter @b2b/api exec jest --testPathPattern=pricing` — 19/19 green.
- [ ] CI pipeline (`.github/workflows/ci.yml`) green on the release commit: install, lint,
      typecheck, unit, build, e2e (Playwright), lighthouse, security (pnpm audit + CodeQL).

---

## 1. Environment variables (validated against `env.validation.ts`)

The API boots through Joi validation in `apps/api/src/config/env.validation.ts`; a missing or
malformed var **fails fast at startup**. Confirm every var below is set in the target environment
(Railway for API, Vercel for web).

### API (Railway)

- [ ] `DATABASE_URL` — Supabase **pooler**, port 6543, `?pgbouncer=true&connection_limit=5`.
- [ ] `DATABASE_DIRECT_URL` — Supabase **direct**, port 5432 (migrations only).
- [ ] `REDIS_CACHE_URL` (6379, LRU) and `REDIS_QUEUE_URL` (6380, AOF) — distinct instances.
- [ ] `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`.
- [ ] `NEXTAUTH_SECRET` — **identical** value to the web app (HS256 merchant tokens are signed by
      web and verified by the API; a mismatch silently 401s every merchant request).
- [ ] `CLERK_SECRET_KEY` (`sk_live_`/`sk_test_`), `CLERK_PUBLISHABLE_KEY` (`pk_…`),
      `CLERK_WEBHOOK_SECRET` (`whsec_…`).
- [ ] `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET_NAME`, `S3_REGION`, `S3_KMS_KEY_ARN`.
- [ ] `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, `PADDLE_ENV` (`sandbox`/`production`),
      `PADDLE_CHECKOUT_URL`, and all four price IDs (`PADDLE_STARTER_PRICE_ID`,
      `PADDLE_GROWTH_PRICE_ID`, `PADDLE_PRO_PRICE_ID`, `PADDLE_GMV_PRICE_ID`).
- [ ] `RESEND_API_KEY`, `RESEND_FROM_ADDRESS` (verified sending domain).
- [ ] `ENCRYPTION_KEY_V1`, `CURRENT_ENCRYPTION_KEY_VERSION` (default `1`).
- [ ] `RESOLVE_API_KEY`, `RESOLVE_WEBHOOK_SECRET`.
- [ ] `OTEL_EXPORTER_OTLP_ENDPOINT`, `SENTRY_DSN`.
- [ ] `ALLOWED_ORIGINS` (CORS — the web origin only, no wildcard in prod).
- [ ] `NODE_ENV=production`, `PLATFORM_DOMAIN`, `INTERNAL_API_SECRET` (≥ 32 chars).

### Web (Vercel)

- [ ] `NEXT_PUBLIC_API_BASE_URL`, `API_BASE_URL` (server-side).
- [ ] `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`.
- [ ] `NEXTAUTH_SECRET` (matches API), `NEXTAUTH_URL` (canonical https origin).
- [ ] `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `INTERNAL_API_SECRET` (matches API).
- [ ] `PLATFORM_DOMAIN`.

> Secret hygiene: rotate per `docs/runbooks/secrets-rotation.md`. Never reuse `sk_test_`/`pk_test_`
> Clerk keys or Paddle sandbox keys in production.

---

## 2. Database & tenancy (Supabase)

- [ ] Migrations applied via the **direct** (5432) connection: `pnpm db:migrate`.
- [ ] RLS bootstrap run once in the Supabase SQL editor:
      `CREATE ROLE app_user; CREATE ROLE audit_writer; GRANT app_user TO authenticator;`
- [ ] `003_rls.sql` policies applied and **verified active** — both tenancy layers
      (`where:{merchantId}` AND Postgres RLS) must be live. Spot-check: a query without merchant
      context returns zero rows.
- [ ] `invoice_number_seq` exists and is continuous.
- [ ] Audit-log immutability trigger present (no UPDATE/DELETE on `audit_log`).
- [ ] GIN trigram index on `buyers.company_name` present.
- [ ] PITR enabled (RPO target ≤ 5 min — see `disaster-recovery.md`).
- [ ] **Open schema deltas reconciled** (carry-over from CLAUDE.md FINAL STATE — confirm or
      consciously defer): buyers `passwordHash`/`loginFailCount`/`lockedUntil` removal;
      `merchant_users` password/mfa fields; Prompt 4 `'defaulted'` `InvoiceStatus`; migration 004
      (`drop clerk_org_id`) applied.

---

## 3. External integrations & webhooks

Every external call is opossum-breaker-wrapped; every webhook verifies its signature **before**
processing. Confirm endpoints and secrets line up.

- [ ] **Shopify Partners:** app OAuth redirect URLs point at the prod web origin; required scopes
      set; all 8 webhook topics registered to the API; App Proxy configured
      (`/apps/wholesale/:path*` → web `/portal/:path*`) and HMAC-verified by edge middleware.
- [ ] **Clerk:** webhook endpoint → `POST /webhooks/clerk`, Svix signing secret = `CLERK_WEBHOOK_SECRET`;
      `user.created` / `user.updated` / `user.deleted` subscribed. Endpoint excluded from
      ValidationPipe + rate limiting.
- [ ] **Paddle:** notification destination (webhook) registered; `PADDLE_WEBHOOK_SECRET` matches;
      `PADDLE_ENV` set correctly; subscription products/recurring prices + the catalog GMV-overage
      price exist and IDs match env; default payment link set for `PADDLE_CHECKOUT_URL`. Signature
      verified in-controller.
- [ ] **Resolve (BNPL):** webhook HMAC secret = `RESOLVE_WEBHOOK_SECRET`; all Resolve traffic goes
      through `BnplAdapter` (never the SDK directly).
- [ ] **Resend:** sending domain verified (SPF/DKIM); `RESEND_FROM_ADDRESS` matches.
- [ ] Replay protection confirmed: re-sending a captured webhook is deduped via `webhook_events` /
      `idempotency_keys` (no double-processing).

---

## 4. Web app (Vercel)

- [ ] `vercel.json` security headers live: CSP whitelisting Clerk domains, HSTS,
      `X-Frame-Options: DENY` + `frame-ancestors 'none'`, `X-Content-Type-Options`,
      `Referrer-Policy`, COOP, CORP, `Permissions-Policy`. (COEP intentionally omitted — it breaks
      Clerk widgets.)
- [ ] `next.config.mjs`: `output:'standalone'`, `images.remotePatterns` for `*.shopifycdn.com` /
      `cdn.shopify.com` / `img.clerk.com`, `poweredByHeader:false`, `serverActions.allowedOrigins`.
- [ ] Merchant sign-in (`signIn('shopify')`) completes end-to-end against the prod Shopify app.
- [ ] Buyer sign-in/sign-up (Clerk) renders and authenticates on the App-Proxy storefront path.
- [ ] Middleware gating verified: unauthenticated merchant → `/merchant-login`; unauthenticated
      buyer → buyer login; App-Proxy HMAC sets `__merchant_domain` / `__merchant_id` cookies.
- [ ] Lighthouse budget (`.lighthouse-budget.json` / `.lighthouserc.json`) within thresholds.

---

## 5. Smoke test (staging first, then production)

Run against the deployed environment, not localhost:

- [ ] Health checks return 200 (and are `@SkipThrottle()`).
- [ ] Merchant: sign in → dashboard KPIs + AR-aging chart load (real `getMerchantDashboard` /
      `getArAging`).
- [ ] Merchant: buyer approval queue (`GET /buyers/applications?status=pending`) loads; approve a
      test buyer; rejection path works.
- [ ] Buyer: catalog (`GET /buyer/catalog`, cursor + search) loads; bulk order table prices
      server-side; **submit an order with an `Idempotency-Key`** and confirm a re-submit replays
      (no duplicate order).
- [ ] Invoice generated → PDF stored in S3 (SSE-KMS) → presigned download works → SHA-256 integrity
      verifies → invoice email delivered via Resend.
- [ ] Merchant invoice list (`GET /invoices`, with `status`/`buyerId`/`agingBucket`) and buyer
      invoice list (`GET /buyer/invoices`) return correctly scoped data.
- [ ] `mark-paid` updates AR + GMV; `void` and rate-limited `resend` (429 on the 2nd within 300s)
      behave.
- [ ] Cross-tenant check: a merchant cannot read another merchant's orders/invoices/buyers (RLS +
      app filter both enforced).

---

## 6. Observability & rollback readiness

- [ ] Sentry receiving events from API **and** web (trigger a test error).
- [ ] OpenTelemetry traces arriving in Grafana Cloud; correlation IDs flow end-to-end.
- [ ] Structured logs (Pino → Better Stack) emitting with PII masked.
- [ ] Alerts wired: queue depth, breaker-open events, 5xx rate, webhook failure rate.
- [ ] Rollback rehearsed: Vercel instant rollback + Railway redeploy-previous documented and
      known-good (see `disaster-recovery.md` → _Bad deploy_).
- [ ] Dead-letter queue monitored; BullMQ workers (all 7) running and draining.

---

## 7. Go / No-Go

**GO only if:** every box above is checked, CI is green on the release tag, staging smoke test
passed, and an Incident Commander + rollback plan are in place.

**NO-GO if:** any financial-path item (tenancy/RLS, idempotency, invoice integrity, Paddle/Resolve
signature verification, `NEXTAUTH_SECRET` parity) is unverified — these are non-negotiable.

After go-live, watch Sentry, queue depth, and the first real financial writes for the first hour.
