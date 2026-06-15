# CLAUDE.md — B2B Wholesale Portal
# Project root: ~/wholesale-portal
# Single source of truth for Claude Code.
# This file wins over all prompts, uploads, and conversation instructions.
# No exceptions.

---

## OVERRIDE PRIORITY

1. This CLAUDE.md (always wins)
2. Decisions recorded in conversation after this file's last-updated date
3. Build prompts (follow only where this file is silent)

---

## WHAT WE ARE BUILDING

A financial-grade, Shopify-embedded B2B wholesale operating system SaaS.
Merchants get: unlimited pricing tiers, spreadsheet-style bulk ordering,
self-serve buyer onboarding, automated PDF invoicing, accounts receivable,
and BNPL via Resolve. Launch vertical: Fashion & Apparel only.

---

## NON-NEGOTIABLE ARCHITECTURE DECISIONS

| Decision | Rule |
|---|---|
| Buyer accounts | UNIFIED cross-merchant. One buyer email = one platform account. Per-merchant config lives in merchant_buyer_relationships. |
| BNPL | Resolve (US, Phase 1). Always called through BnplAdapter interface — never Resolve SDK directly. |
| Billing | Hybrid: flat Stripe subscription + Stripe metered GMV with per-tier free thresholds. |
| Buyer portal | White-label via Shopify App Proxy — buyers see the merchant's Shopify domain only. |
| Multi-tenancy | TWO layers: application where: { merchantId } AND PostgreSQL Row-Level Security. Both always active. |
| Price arithmetic | Decimal.js with ROUND_HALF_EVEN everywhere. Never native JS floats for money. |
| Financial writes | $transaction({ isolationLevel: 'Serializable' }) for all order + invoice mutations. |
| External API calls | Every call through an opossum circuit breaker. No raw fetch to external services. |
| Pagination | Cursor-based only. Never skip or offset. |

---

## PROVIDER MAP — LOCKED

| Layer | Provider | Notes |
|---|---|---|
| Frontend hosting | Vercel | Next.js 14 App Router |
| Backend hosting | Railway | NestJS 10 API only — no database on Railway |
| Database | Supabase | PostgreSQL 16 + built-in PgBouncer |
| Redis CACHE | Railway Redis | LRU eviction, port 6379 |
| Redis QUEUE | Railway Redis | AOF persistence, port 6380, BullMQ only |
| Merchant auth | NextAuth.js v4 + Shopify OAuth | Required — Shopify session tokens cannot be verified by Clerk |
| Buyer auth | Clerk | Buyers have no Shopify identity — Clerk owns buyer sessions entirely |
| File storage | AWS S3 | SSE-KMS, private bucket, presigned URLs only |
| Email | Resend | React Email templates |
| Payments | Stripe | Hybrid subscription + metered GMV |
| BNPL | Resolve | Via BnplAdapter interface |
| Shopify | Shopify Partners | OAuth, App Bridge, webhooks, App Proxy |
| Tracing | OpenTelemetry → Grafana Cloud | OTLP export |
| Errors | Sentry | Backend + frontend |
| Logging | Pino / Better Stack | Structured JSON, PII masked at emit |
| CI/CD | GitHub Actions | 8-stage pipeline |

---

## WHY AUTH IS SPLIT

This is a Shopify embedded app. The two user types have fundamentally
different identity contexts.

MERCHANT ADMIN runs inside Shopify Admin as an iframe. Shopify App Bridge
generates short-lived session tokens on every request. The backend must
verify these against Shopify's public JWKS endpoint. Clerk cannot generate
or verify Shopify session tokens. Merchant auth MUST use NextAuth +
Shopify OAuth. This is a Shopify platform requirement, not a preference.

BUYER PORTAL runs via Shopify App Proxy on the merchant's storefront.
Buyers are not Shopify entities. They have no Shopify account and no
Shopify session token. You control buyer auth completely. Clerk handles
buyer sessions, brute-force protection, password management, and token
rotation.

NEVER mix these. Never use Clerk for merchants. Never use NextAuth
for buyers.

---

## MERCHANT AUTHENTICATION — NEXTAUTH + SHOPIFY OAUTH

### Files to implement (exactly as original prompts define):

apps/web/src/app/api/auth/[...nextauth]/route.ts
- Shopify OAuth provider with PKCE flow
- shopify_domain pulled from state parameter
- signIn callback: upsert merchant + owner merchant_user via
  POST /internal/merchants/upsert
- JWT callback: encode merchantId, shopifyDomain, role
  (HS256, 7-day, sliding window — extend if within 24h of expiry)
- Session callback: expose merchantId, shopifyDomain, role to client
- Cookies: httpOnly, Secure, SameSite=Strict, __Secure- prefix in prod

apps/api/src/auth/guards/merchant-session.guard.ts
- Validates NextAuth JWT on every merchant request
- Extracts merchantId and role from verified payload
- Calls MerchantContextService.run(merchantId) to set RLS context
- Attaches { merchantId, shopifyDomain, role } to request.merchant
- Throws 401 with codes: MISSING_TOKEN, INVALID_TOKEN, MERCHANT_INACTIVE

### Files that do NOT exist — never create:
- apps/api/src/auth/guards/clerk-merchant.guard.ts

---

## BUYER AUTHENTICATION — CLERK

### Files to implement:

apps/api/src/auth/guards/clerk-buyer.guard.ts
Used on all buyer routes requiring merchant approval.
- Extract Bearer token from Authorization header
- Call verifyToken(token, { secretKey: CLERK_SECRET_KEY }) from @clerk/backend
- Read merchantId from __merchant_domain cookie (set by App Proxy middleware)
- Query merchant_buyer_relationships WHERE merchantId = ? AND
  buyer.clerkUserId = payload.sub
- No relationship: ForbiddenException code NO_RELATIONSHIP
- approvalStatus suspended: ForbiddenException code BUYER_SUSPENDED
- approvalStatus not approved: ForbiddenException code BUYER_NOT_APPROVED
- buyer.anonymizedAt is set: UnauthorizedException code ACCOUNT_ERASED
- Attach { buyerId, clerkUserId, merchantId, pricingTierId, paymentTerms }
  to request.buyer
- NOTE: One DB query per request for approval check. Intentional. Do not
  attempt to eliminate it.

apps/api/src/auth/guards/clerk-authenticated.guard.ts
Used on pre-approval buyer routes (apply endpoint only).
- Extract and verify Bearer token via Clerk
- No approval status check — buyer is authenticated but not yet approved
- Attach { clerkUserId, email: payload.email } to request.buyerIdentity

apps/api/src/auth/clerk-webhooks.controller.ts
- POST /webhooks/clerk
- Verify Svix signature using CLERK_WEBHOOK_SECRET before any processing
- Handle user.created:
    UPDATE buyers SET clerkUserId = event.data.id
    WHERE email = event.data.email_addresses[0].email_address
- Handle user.updated:
    If event.data.email_addresses[0].verification.status === 'verified':
    UPDATE buyers SET emailVerifiedAt = NOW()
    WHERE clerkUserId = event.data.id
    Only update if emailVerifiedAt IS NULL (do not overwrite existing timestamp)
- Handle user.deleted: log only — GDPR erasure runs via internal pipeline
- Return { received: true }
- EXCLUDED from ValidationPipe and rate limiting

apps/web/src/app/(auth)/buyer-login/page.tsx
Clerk SignIn component, styled per design rules below.

apps/web/src/app/(auth)/buyer-signup/page.tsx
Clerk SignUp component, styled per design rules below.

### Files that do NOT exist — never create:
- apps/api/src/auth/services/buyer-auth.service.ts
- apps/api/src/auth/guards/buyer-jwt.guard.ts

---

## PRISMA SCHEMA — FINAL STATE

### datasource block (always both URLs):

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DATABASE_DIRECT_URL")
}

### merchants table:
No changes from original prompts. Do not add clerkOrgId.
Merchants are identified by shopifyDomain.

### merchant_users table:
Keep exactly as original prompts define.
Fields: id, merchantId, email, passwordHash, role, firstName, lastName,
mfaSecret, lastLoginAt, loginFailCount, lockedUntil, isActive,
createdAt, updatedAt.
Shopify OAuth populates the owner record on install.
passwordHash is retained for potential future staff direct-login capability.

### buyers table — MODIFIED from original prompts:

REMOVE these fields (Clerk owns them):
- passwordHash
- loginFailCount
- lockedUntil

ADD this field:
- clerkUserId String? @unique @map("clerk_user_id")
  Nullable — Clerk webhook may arrive after buyer record is created.
  The clerk-buyer.guard handles this race condition by checking for null
  and returning NO_RELATIONSHIP (treated as unapproved, not as an error).

KEEP all other buyer fields unchanged:
id, email, companyName, businessType, taxId, taxIdKeyVersion,
phone, phoneKeyVersion, addressJson, emailVerifiedAt, lastLoginAt,
anonymizedAt, createdAt, updatedAt.

emailVerifiedAt is synced from Clerk via user.updated webhook.
See clerk-webhooks.controller.ts above.

### refresh_tokens table:
REMOVE entirely. Clerk manages buyer sessions. NextAuth manages merchant
sessions. No custom refresh token table is needed or correct.

### All other tables:
Unchanged from original prompts.
merchant_buyer_relationships, pricing_tiers, pricing_tier_overrides,
orders, order_line_items, invoices, buyer_registration_applications,
webhook_events, idempotency_keys, audit_log — all unchanged.

---

## DATABASE — SUPABASE

DATABASE_URL — Supabase pooler (PgBouncer), port 6543, app runtime:
postgresql://postgres.[ref]:[pass]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=5

DATABASE_DIRECT_URL — Supabase direct, port 5432, migrations only:
postgresql://postgres.[ref]:[pass]@aws-0-[region].pooler.supabase.com:5432/postgres

RLS setup — run once in Supabase SQL editor after project creation:
  CREATE ROLE app_user;
  CREATE ROLE audit_writer;
  GRANT app_user TO authenticator;
Then: pnpm db:migrate

docker-compose.yml:
  KEEP: redis-cache (6379, allkeys-lru), redis-queue (6380, appendonly, noeviction)
  REMOVE: postgres service, pgadmin service
  Local PostgreSQL: npx supabase start

---

## GUARD USAGE — ENFORCED IN ALL CONTROLLERS

| Context | Guard | Import from |
|---|---|---|
| Merchant admin route | MerchantSessionGuard | ../auth/guards/merchant-session.guard |
| Buyer route (requires approval) | ClerkBuyerGuard | ../auth/guards/clerk-buyer.guard |
| Buyer route (pre-approval only) | ClerkAuthenticatedGuard | ../auth/guards/clerk-authenticated.guard |
| Shopify webhook route | WebhookHmacGuard | ../webhooks/webhook-hmac.guard |
| Clerk webhook route | No guard — Svix verified inside controller | — |
| Stripe webhook route | No guard — Stripe sig verified inside controller | — |
| Resolve webhook route | No guard — HMAC verified inside controller | — |
| Health check routes | No guard + @SkipThrottle() | — |

---

## ENVIRONMENT VARIABLES — VALIDATED LIST

Remove (no longer needed):
- AUTH_PRIVATE_KEY
- AUTH_PUBLIC_KEY

Add:
- CLERK_SECRET_KEY (required — starts with sk_live_ or sk_test_)
- CLERK_PUBLISHABLE_KEY (required — starts with pk_live_ or pk_test_)
- CLERK_WEBHOOK_SECRET (required — starts with whsec_)
- DATABASE_DIRECT_URL (required — Supabase direct connection for migrations)

Complete validated list for env.validation.ts:
DATABASE_URL, DATABASE_DIRECT_URL,
REDIS_CACHE_URL, REDIS_QUEUE_URL,
SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET,
NEXTAUTH_SECRET,
CLERK_SECRET_KEY, CLERK_PUBLISHABLE_KEY, CLERK_WEBHOOK_SECRET,
AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
S3_BUCKET_NAME, S3_REGION, S3_KMS_KEY_ARN,
STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
STRIPE_STARTER_PRICE_ID, STRIPE_GROWTH_PRICE_ID,
STRIPE_PRO_PRICE_ID, STRIPE_GMV_METERED_PRICE_ID,
RESEND_API_KEY, RESEND_FROM_ADDRESS,
ENCRYPTION_KEY_V1, CURRENT_ENCRYPTION_KEY_VERSION (default: 1),
RESOLVE_API_KEY, RESOLVE_WEBHOOK_SECRET,
OTEL_EXPORTER_OTLP_ENDPOINT,
SENTRY_DSN,
ALLOWED_ORIGINS,
NODE_ENV (enum: development | staging | production, default: development),
PLATFORM_DOMAIN,
INTERNAL_API_SECRET (min 32 chars)

---

## UI DESIGN SYSTEM — MINIMALISM WITH FUNCTIONAL DEPTH

### Philosophy:
Minimalism dominates all layout, spacing, and color decisions.
Skeuomorphic depth cues are applied only to interactive elements
where they reduce cognitive load (buttons that look pressable,
inputs that look writable). If a depth cue does not help the user
understand what to do, it does not exist.

This is accounting software used by wholesale buyers placing large orders
and merchant staff managing receivables. Every pixel must earn its place.

### FORBIDDEN — never use:
- backdrop-filter: blur
- Frosted or translucent backgrounds
- Gradient backgrounds of any kind
- shadow-md, shadow-lg, shadow-xl, shadow-2xl on any layout container
- active:translate-y-px or any transform on interactive elements
  (causes layout repaints; unreliable on Safari without touch listeners)
- Animated backgrounds or transitions longer than 100ms
- Decorative shapes, blobs, or fills
- More than 2 font weights in any single view
- Icon-only buttons on any primary action
- Multiple accent colors

### Layout rules (minimalism governs):
- Page background: gray-50 (#f9fafb)
- Content panels: white (#ffffff)
- Secondary panels, sidebars: gray-100 (#f3f4f6)
- Single accent color for all CTAs — one color, used consistently
- Table rows: compact, 20+ visible without vertical scroll
- Typography: 3 sizes maximum per view (heading, body, label)
- Structure comes from 1px borders and consistent spacing
- Status badges: solid fill only (bg-green-100 text-green-800)
  Never outlined. Never translucent.

### Interactive element depth cues (skeuomorphism, shadow-only):

Button — default state (appears slightly raised):
  border border-gray-300 bg-white shadow-sm
  transition-shadow duration-75

Button — active/pressed state (shadow collapses = pressed feel):
  active:shadow-none active:border-gray-400
  No translate. No movement. Shadow removal signals press universally,
  including Safari, without requiring touch event listeners or cursor-pointer
  on non-button elements.

Button — primary CTA:
  bg-{accent} border border-{accent-dark} shadow-sm
  active:shadow-none active:brightness-95
  transition-shadow duration-75

Form inputs (appear recessed into the surface):
  bg-gray-50 border border-gray-300 shadow-inner
  focus:bg-white focus:border-gray-400 focus:ring-0
  transition-colors duration-75
  Note: shadow-inner is the only skeuomorphic cue here.
  Do not add focus glow rings — they are decorative in this context.

Cards and panels (one layer of depth only):
  border border-gray-200 shadow-sm bg-white
  Never stack shadows. Never add hover:shadow-md.

Data tables:
  Alternating bg-white / bg-gray-50 rows
  border-b border-gray-200 between rows
  Clickable rows: hover:bg-blue-50 (only if row triggers navigation)
  No hover effect on non-clickable rows

Invoice PDF:
  Background: #fafaf8 (paper tone, not pure white)
  Rule lines: 0.5pt, #d1d5db
  Numbers: monospace font, right-aligned
  Labels: regular weight, left-aligned
  No decorative boxes, colored headers, or rounded corners
  Looks like a printed accounting document from a reputable firm

### What this combination produces:
A UI that feels physically real in its interactive elements
while maintaining the density and clarity of enterprise software.
The benchmark is a well-designed physical ledger combined with
Shopify Admin information architecture.

---

## CODE QUALITY RULES — ALWAYS ENFORCED

- TypeScript strict mode — zero any in business logic files
- Every file 100% complete — zero stubs, zero TODOs, zero ellipses
- All imports resolve to real packages in the locked stack
- All env vars referenced must exist in env.validation.ts
- All error paths handled — no unhandled promise rejections
- All prices computed with Decimal.js — never native JS floats
- All financial writes inside Prisma $transaction with correct isolation
- All external API calls wrapped in opossum circuit breaker
- All webhook endpoints verify HMAC/signature before any processing
- Audit log written for every state change on financial entities
- Logger: import createLogger from @wholesale-portal/shared/utils/logger,
  pass { correlationId } on every structured log call
- Error codes: snake_case strings exported from
  packages/shared/constants/error-codes.ts

---

## WHAT DOES NOT CHANGE

Everything below is identical to the original build prompts. Do not modify.

Business logic:
PricingService, OrdersService, InvoicesService, InvoicePdfService,
StorageService, EmailService, BuyersService (approval flow + GDPR),
BillingService, BnplService + ResolveAdapter, CatalogService,
AnalyticsController

Infrastructure:
EncryptionService (AES-256-GCM, key versioning),
MerchantContextService (AsyncLocalStorage),
PrismaService (RLS middleware, statement_timeout, slow query log),
RedisModule (REDIS_CACHE + REDIS_QUEUE tokens),
RateLimitGuard (per-IP + per-merchant by subscription tier),
IdempotencyMiddleware (all POST/PATCH routes),
CircuitBreakerFactory (opossum, named breakers),
ShopifyApiService (rate-limit aware, circuit-breaker wrapped),
WebhookHmacGuard (HMAC + timestamp replay prevention + domain check),
All 8 Shopify webhook topics,
All 5 BullMQ queues, all 7 workers,
OpenTelemetry + correlation middleware,
All RLS SQL policies,
Audit log immutability trigger,
invoice_number_seq,
GIN trigram index on buyers.company_name

Frontend (except auth pages):
All Next.js pages and layouts,
BulkOrderTable (virtualization, CSV import, volume break tooltip, cart),
Merchant dashboard (KPI cards, AR aging chart, GMV trend chart),
BuyerApprovalPanel (Sheet slide-over, approval + rejection tabs),
All shared components (StatusBadge, CursorPagination, LoadingSkeleton,
ErrorBoundary, ConfirmDialog),
All TanStack Query hooks,
Edge middleware (App Proxy HMAC, merchant redirect, buyer redirect),
Vercel config, Next.js config

CI/CD:
All 8 GitHub Actions jobs,
All Playwright E2E tests,
All k6 load tests,
All runbooks in docs/runbooks/

---

## PACKAGE VERSIONS — DO NOT UPGRADE OR SUBSTITUTE

next: 14.x
@nestjs/core and all @nestjs/*: 10.x
prisma and @prisma/client: 5.x
bullmq: 5.x
@clerk/backend: latest stable
@clerk/nextjs: latest stable
svix: latest stable
next-auth: 4.x (NOT v5 — v5 breaks Shopify OAuth PKCE flow)
@tanstack/react-query: 5.x
@tanstack/react-virtual: 3.x
opossum: latest stable
decimal.js: latest stable
@react-pdf/renderer: latest stable
@aws-sdk/client-s3: 3.x
@aws-sdk/s3-request-presigner: 3.x
ioredis: 5.x
pino: 8.x
date-fns: 3.x
zod: 3.x
react-hook-form: 7.x
stripe: 14.x or latest stable
typescript: 5.x

---

## MONOREPO LAYOUT

~/wholesale-portal/
 apps/
   ├── web/           # Next.js 14 — merchant admin + buyer portal
   └── api/           # NestJS 10 backend
 packages/
   ├── shared/        # TypeScript types, Zod schemas, utils, error codes
   └── database/      # Prisma schema, migrations, generated client
 tests/
   ├── e2e/           # Playwright specs
   └── load/          # k6 load test scripts
 docs/
   └── runbooks/
 CLAUDE.md
 turbo.json
 pnpm-workspace.yaml
 package.json
 docker-compose.yml
 .github/
    ├── workflows/ci.yml
    └── dependabot.yml

---

## FILES SUMMARY

Create (new — not in original prompts):
  apps/api/src/auth/guards/clerk-buyer.guard.ts
  apps/api/src/auth/guards/clerk-authenticated.guard.ts
  apps/api/src/auth/clerk-webhooks.controller.ts
  apps/web/src/app/(auth)/buyer-login/page.tsx
  apps/web/src/app/(auth)/buyer-signup/page.tsx

Restore exactly as original prompts define:
  apps/web/src/app/api/auth/[...nextauth]/route.ts
  apps/api/src/auth/guards/merchant-session.guard.ts

Never create:
  apps/api/src/auth/services/buyer-auth.service.ts
  apps/api/src/auth/guards/buyer-jwt.guard.ts
  apps/api/src/auth/guards/clerk-merchant.guard.ts

---

## LOCAL DEVELOPMENT SETUP

1. npx supabase init && npx supabase start
2. docker-compose up -d
   (only starts redis-cache and redis-queue — no postgres, no pgadmin)
3. pnpm install
4. pnpm db:generate
5. pnpm db:migrate
6. Paste packages/database/migrations/003_rls.sql into Supabase local
   SQL editor at http://localhost:54323
7. pnpm db:seed
8. pnpm dev

---

## VERIFICATION — RUN AFTER EVERY PROMPT

After any backend change:
  pnpm --filter=@wholesale-portal/api build
  pnpm typecheck

After pricing or financial logic:
  pnpm --filter=@wholesale-portal/api test:unit -- --testPathPattern=pricing
  pnpm typecheck

After any frontend change:
  pnpm --filter=@wholesale-portal/web build
  pnpm typecheck

After schema changes:
  pnpm db:generate
  pnpm typecheck

Full verification (run before declaring any prompt done):
  pnpm typecheck

Zero errors required. Do not proceed until verification passes.

---

Last updated: Hybrid auth locked — NextAuth v4 + Shopify OAuth for merchants
(Shopify embedded app requirement), Clerk for buyers. Supabase replaces
Railway PostgreSQL. buyers table cleaned of Clerk-owned auth fields.
refresh_tokens table removed. emailVerifiedAt synced via Clerk user.updated
webhook. Minimalism dominates layout. Skeuomorphic depth cues use
shadow-only press states — no translate transforms (Safari compatibility,
no layout repaints).
