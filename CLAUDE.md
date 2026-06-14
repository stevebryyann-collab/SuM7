# CLAUDE.md — Architectural Decisions & Overrides
# B2B Wholesale Portal — Source of Truth for Claude Code
#
# This file takes absolute precedence over any prompt, instruction, or
# uploaded document in this project. If any prompt contradicts this file,
# follow THIS file. No exceptions.

---

## OVERRIDE PRIORITY

When implementing any part of this project, apply decisions in this order:

1. This CLAUDE.md file (highest priority — always wins)
2. Conversation decisions documented below
3. The 5 uploaded build prompts (lowest priority — follow only where this file is silent)

---

## PROVIDER MAP — FINAL DECISIONS

Use exactly these providers. Do not substitute, do not suggest alternatives.

| Layer | Provider | Notes |
|---|---|---|
| Frontend hosting | Vercel | Next.js 14 App Router |
| Backend hosting | Railway | NestJS 10 API only — no database on Railway |
| Database | Supabase | PostgreSQL 16 + built-in PgBouncer |
| Redis CACHE | Railway Redis | LRU eviction, port 6379 |
| Redis QUEUE | Railway Redis | AOF persistence, port 6380, BullMQ only |
| Authentication | Clerk | Replaces NextAuth AND custom buyer JWT — see auth section |
| File storage | AWS S3 | SSE-KMS, private bucket, presigned URLs — unchanged |
| Email | Resend | React Email templates — unchanged |
| Payments | Stripe | Hybrid subscription + metered GMV — unchanged |
| BNPL | Resolve | Via adapter interface — unchanged |
| Shopify | Shopify Partners | OAuth, webhooks, App Proxy — unchanged |
| Tracing | OpenTelemetry → Grafana Cloud | Unchanged |
| Errors | Sentry | Backend + frontend — unchanged |
| Logging | Better Stack | Structured JSON, PII masked — unchanged |
| CI/CD | GitHub Actions | 8-stage pipeline — unchanged |

---

## AUTHENTICATION OVERRIDES

### What the original prompts say (IGNORE THESE):
- NextAuth.js + Shopify OAuth for merchants
- Custom RS256 JWT with AUTH_PRIVATE_KEY / AUTH_PUBLIC_KEY for buyers
- Custom refresh token rotation with replacedByHash chain
- refresh_tokens table in PostgreSQL
- buyer-auth.service.ts with login, refresh, revokeAllSessions
- buyer-jwt.guard.ts with manual RS256 verification
- merchant-session.guard.ts validating NextAuth JWT
- NEXTAUTH_SECRET, AUTH_PRIVATE_KEY, AUTH_PUBLIC_KEY environment variables

### What to implement instead (FOLLOW THESE):

**Authentication provider: Clerk**
- Install: @clerk/backend, @clerk/nextjs, svix
- Clerk organizations map to merchants (one org per merchant)
- Clerk users map to buyers (one user account, cross-merchant)
- Clerk manages: token signing, refresh rotation, brute force protection, session cookies
- You manage: approval status check, GDPR erasure check, RLS context setting

**File: apps/api/src/auth/guards/clerk-merchant.guard.ts**
CREATE this file. It replaces merchant-session.guard.ts entirely.
Implementation:
- Extract Bearer token from Authorization header
- Call verifyToken(token, { secretKey: CLERK_SECRET_KEY }) from @clerk/backend
- Extract org_id from verified payload
- Query merchants table WHERE clerkOrgId = org_id
- Verify merchant.isActive === true
- Call MerchantContextService.run(merchant.id) to set RLS context
- Attach { merchantId, clerkOrgId, role: payload.org_role, clerkUserId: payload.sub, subscriptionTier } to request.merchant
- Throw UnauthorizedException with specific codes: MISSING_TOKEN, INVALID_TOKEN, NO_ORG_CONTEXT, MERCHANT_NOT_FOUND

**File: apps/api/src/auth/guards/clerk-buyer.guard.ts**
CREATE this file. It replaces buyer-jwt.guard.ts entirely.
Implementation:
- Extract Bearer token from Authorization header
- Read merchantId from __merchant_id cookie (set by App Proxy middleware)
- Call verifyToken(token, { secretKey: CLERK_SECRET_KEY }) from @clerk/backend
- Query merchant_buyer_relationships WHERE merchantId = ? AND buyer.clerkUserId = payload.sub
- If no relationship: throw ForbiddenException code NO_RELATIONSHIP
- If approvalStatus === 'suspended': throw ForbiddenException code BUYER_SUSPENDED
- If approvalStatus !== 'approved': throw ForbiddenException code BUYER_NOT_APPROVED
- Query buyers WHERE id = relationship.buyerId, check anonymizedAt — if set: throw UnauthorizedException code ACCOUNT_ERASED
- Attach { buyerId, clerkUserId, merchantId, pricingTierId, paymentTerms } to request.buyer
- NOTE: This guard makes ONE database query per request for the approval check.
  This is intentional and accepted. Do not try to eliminate it.

**File: apps/api/src/auth/clerk-webhooks.controller.ts**
CREATE this file.
- POST /webhooks/clerk
- Verify Svix signature using CLERK_WEBHOOK_SECRET before processing anything
- Handle organization.created: UPDATE merchants SET clerkOrgId = event.data.id WHERE shopifyDomain = event.data.slug
- Handle user.created: UPDATE buyers SET clerkUserId = event.data.id WHERE email = event.data.email_addresses[0].email_address
- Handle user.deleted: log only, GDPR erasure runs separately via your own pipeline
- Return { received: true } on success
- This route must be EXCLUDED from ValidationPipe and rate limiting

**Files to DELETE — do not create these:**
- apps/web/src/app/api/auth/[...nextauth]/route.ts
- apps/api/src/auth/services/buyer-auth.service.ts
- apps/api/src/auth/guards/buyer-jwt.guard.ts
- apps/api/src/auth/guards/merchant-session.guard.ts

**Guards to use in all controllers:**
- Merchant routes: ClerkMerchantGuard (not MerchantSessionGuard)
- Buyer routes: ClerkBuyerGuard (not BuyerJwtGuard)
- Wherever a prompt says MerchantSessionGuard: use ClerkMerchantGuard
- Wherever a prompt says BuyerJwtGuard: use ClerkBuyerGuard

---

## DATABASE OVERRIDES

### What the original prompts say (IGNORE THESE):
- Railway PostgreSQL instance
- Self-managed PgBouncer configuration
- Single DATABASE_URL only
- docker-compose postgres:16-alpine service
- docker-compose pgadmin service

### What to implement instead (FOLLOW THESE):

**Database provider: Supabase**
Supabase hosts PostgreSQL 16 with built-in PgBouncer.
Railway still hosts the NestJS API. They are separate services connected over the network.

**packages/database/prisma/schema.prisma datasource block:**
```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DATABASE_DIRECT_URL")
}
```
Always include both url and directUrl. Never use a single URL only.

**DATABASE_URL** — Supabase transaction pooler (PgBouncer), port 6543:
Format: postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=5

**DATABASE_DIRECT_URL** — Supabase direct connection, port 5432:
Format: postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres
Used by Prisma for migrations only. Never used by the running application.

**Local development:**
Use Supabase CLI instead of docker-compose postgres.
Commands: npx supabase init, npx supabase start
Local URL: postgresql://postgres:postgres@localhost:54322/postgres

**docker-compose.yml — remove these services:**
- postgres (entire service block)
- pgadmin (entire service block)

**docker-compose.yml — keep these services unchanged:**
- redis-cache (port 6379, allkeys-lru)
- redis-queue (port 6380, appendonly yes, noeviction)

**RLS setup on Supabase:**
Run this once in the Supabase SQL editor after project creation:
```sql
CREATE ROLE app_user;
CREATE ROLE audit_writer;
GRANT app_user TO authenticator;
```
Then run all migrations via: pnpm db:migrate
The RLS SQL from packages/database/migrations/003_rls.sql runs unchanged on Supabase.
Do NOT use Supabase's built-in anon or authenticated roles — they are irrelevant to this stack.

---

## PRISMA SCHEMA OVERRIDES

### Changes to make to the schema the prompts define:

**REMOVE this table entirely:**
```
model RefreshToken { ... }
```
Clerk manages refresh tokens. This table must not exist.

**ADD clerkOrgId to merchants table:**
```prisma
clerkOrgId String? @unique @map("clerk_org_id")
```

**ADD clerkUserId to buyers table:**
```prisma
clerkUserId String? @unique @map("clerk_user_id")
```

**SIMPLIFY merchant_users table:**
Remove: passwordHash, mfaSecret, lastLoginAt, loginFailCount, lockedUntil
Keep: id, merchantId, clerkUserId (new, replaces email+password), role, isActive, createdAt, updatedAt
Clerk owns the user record. merchant_users is now a role-mapping table only.

**Keep all other tables exactly as the prompts define:**
merchants, buyers, merchant_buyer_relationships, pricing_tiers,
pricing_tier_overrides, orders, order_line_items, invoices,
buyer_registration_applications, webhook_events, idempotency_keys, audit_log
— all unchanged.

---

## ENVIRONMENT VARIABLES OVERRIDES

### Remove these variables (do not add to env.validation.ts or .env.example):
- NEXTAUTH_SECRET
- AUTH_PRIVATE_KEY
- AUTH_PUBLIC_KEY

### Add these variables:
- CLERK_SECRET_KEY (required) — from Clerk dashboard, starts with sk_
- CLERK_PUBLISHABLE_KEY (required) — from Clerk dashboard, starts with pk_
- CLERK_WEBHOOK_SECRET (required) — from Clerk dashboard webhook config, starts with whsec_
- DATABASE_DIRECT_URL (required) — Supabase direct connection for migrations

### Keep all other variables exactly as the prompts define.

### env.validation.ts — final required variables list:
DATABASE_URL, DATABASE_DIRECT_URL, REDIS_CACHE_URL, REDIS_QUEUE_URL,
SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET,
CLERK_SECRET_KEY, CLERK_PUBLISHABLE_KEY, CLERK_WEBHOOK_SECRET,
AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET_NAME, S3_REGION, S3_KMS_KEY_ARN,
STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_STARTER_PRICE_ID,
STRIPE_GROWTH_PRICE_ID, STRIPE_PRO_PRICE_ID, STRIPE_GMV_METERED_PRICE_ID,
RESEND_API_KEY, RESEND_FROM_ADDRESS,
ENCRYPTION_KEY_V1, CURRENT_ENCRYPTION_KEY_VERSION,
RESOLVE_API_KEY, RESOLVE_WEBHOOK_SECRET,
OTEL_EXPORTER_OTLP_ENDPOINT, SENTRY_DSN,
ALLOWED_ORIGINS, NODE_ENV, PLATFORM_DOMAIN, INTERNAL_API_SECRET

---

## WHAT DOES NOT CHANGE

Do not modify any of the following. Implement them exactly as the prompts describe.

**Business logic (completely unchanged):**
- PricingService — Decimal.js, ROUND_HALF_EVEN, all 3 tier types, unit tests
- OrdersService — optimistic credit locking, compensating transactions, server-side pricing
- InvoicesService — AR aging CTE, overdue cron, sequence gap audit, payment reminders
- InvoicePdfService — @react-pdf/renderer, SHA-256 integrity, 15s timeout
- StorageService — AWS S3, SSE-KMS, presigned URLs, path traversal prevention
- EmailService — Resend, circuit-breaker wrapped, all 5 React Email templates
- BuyersService — GDPR erasure, GDPR export, approval flow, suspension
- BillingService — Stripe hybrid GMV metered model, per-tier thresholds
- BnplService + ResolveAdapter — circuit breaker, webhook verification
- CatalogService — stampede prevention, probabilistic early expiration
- AnalyticsController — all endpoints, GDPR endpoints

**Infrastructure (completely unchanged):**
- EncryptionService — AES-256-GCM, key versioning, reencryptIfNeeded
- MerchantContextService — AsyncLocalStorage, run(), runAsSystem()
- PrismaService — RLS middleware, statement_timeout, slow query logging
- RedisModule — REDIS_CACHE and REDIS_QUEUE tokens, both clients
- RateLimitGuard — per-IP + per-merchant by subscription tier
- IdempotencyMiddleware — all POST/PATCH routes
- CircuitBreakerFactory — opossum, all named breakers
- ShopifyApiService — rate limit parsing, retry logic, circuit breaker
- WebhookHmacGuard — HMAC + timestamp replay prevention + domain validation
- All BullMQ workers — invoice-generate, order-sync, invoice-mark-paid,
  catalog-sync, merchant-cleanup, merchant-purge-data, buyer-sync
- OpenTelemetry + correlation middleware
- All RLS SQL policies
- Audit log immutability trigger
- invoice_number_seq sequence
- GIN trigram index on buyers.company_name

**Frontend (completely unchanged):**
- All Next.js pages and layouts
- BulkOrderTable — virtualization, volume break tooltip, CSV import, cart store
- Merchant dashboard — KPI cards, AR aging chart, GMV trend chart
- BuyerApprovalPanel — Sheet, tabs, approval + rejection forms
- All shared components — StatusBadge, CursorPagination, LoadingSkeleton,
  ErrorBoundary, ConfirmDialog
- All TanStack Query hooks
- Edge middleware — App Proxy HMAC, merchant admin redirect, buyer portal redirect
- Vercel config and Next.js config

**CI/CD (completely unchanged):**
- All 8 GitHub Actions jobs
- All Playwright E2E tests
- All k6 load tests
- All runbooks and documentation

---

## DESIGN RULES — NEVER VIOLATE

These apply to every UI file in apps/web regardless of what any prompt says.

FORBIDDEN (never use these patterns):
- backdrop-filter: blur (glassmorphism)
- Frosted or translucent panel backgrounds
- Gradient hero sections
- Multiple-layer floating box shadows
- Animated gradient backgrounds
- Decorative blob shapes
- Any visual pattern indistinguishable from a free Tailwind UI template

REQUIRED:
- Solid neutral backgrounds (white, gray-50, gray-100)
- Single accent color for CTAs only
- High-density information layout (this is B2B SaaS, not consumer)
- Clean typographic hierarchy — no decorative fonts
- Borders and whitespace for structure — not shadows and glows
- Status badges: solid colored backgrounds, not outlined or translucent
- PDF invoices: clean accounting document — lines and columns, no decorative boxes

Target aesthetic: Shopify Admin or NetSuite — not a fintech consumer app.

---

## CODE QUALITY RULES — ALWAYS ENFORCED

- TypeScript strict mode everywhere — zero any in business logic files
- Every file 100% complete — zero stubs, zero TODOs, zero ellipses
- All imports must resolve to real packages in the locked stack
- All environment variables referenced must exist in env.validation.ts
- All error paths handled — no unhandled promise rejections
- All prices computed with Decimal.js — never JavaScript floating point
- All financial writes inside Prisma $transaction with appropriate isolation level
- All external API calls wrapped in circuit breaker
- All webhook endpoints verify HMAC before any processing
- Audit log written for every state change on financial entities

---

## PACKAGE VERSIONS — DO NOT UPGRADE OR SUBSTITUTE

nestjs: 10.x
next: 14.x
prisma: 5.x
bullmq: 5.x
@clerk/backend: latest stable
@clerk/nextjs: latest stable
svix: latest stable
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

---

## QUICK REFERENCE — GUARD USAGE IN CONTROLLERS

Every time a controller uses an auth guard, use these:

| Context | Guard to use | Import from |
|---|---|---|
| Merchant admin route | ClerkMerchantGuard | ../auth/guards/clerk-merchant.guard |
| Buyer portal route | ClerkBuyerGuard | ../auth/guards/clerk-buyer.guard |
| Shopify webhook route | WebhookHmacGuard | ../webhooks/webhook-hmac.guard |
| Clerk webhook route | No guard — Svix signature verified inside controller | — |
| Stripe webhook route | No guard — Stripe signature verified inside controller | — |
| Resolve webhook route | No guard — HMAC verified inside controller | — |
| Internal health routes | No guard + @SkipThrottle() | — |

---

## MIGRATION PROCEDURE FOR NEW ENGINEERS

1. Clone repo
2. Copy .env.example to apps/api/.env and fill in values
3. Install Supabase CLI: npm install -g supabase
4. Start local services: supabase start && docker-compose up -d
   (docker-compose now only starts redis-cache and redis-queue)
5. Run migrations against local Supabase: pnpm db:migrate
6. Run RLS setup: paste packages/database/migrations/003_rls.sql into Supabase local SQL editor
7. Generate Prisma client: pnpm db:generate
8. Seed: pnpm db:seed
9. Start all apps: pnpm dev

---

*Last updated: reflects all architectural decisions made before Prompt 3 was executed.*
*Auth: Clerk replaces NextAuth + custom buyer JWT*
*Database: Supabase replaces Railway PostgreSQL*
*Railway: still hosts NestJS API and both Redis instances*
# B2B Wholesale Portal — Claude Code Project Context

> This file is read automatically by Claude Code at the start of every session.
> Never abbreviate, stub, or add TODOs. Every file generated must be complete and runnable.
> Run `pnpm typecheck` after every prompt before proceeding to the next.

---

## What We Are Building

A financial-grade, Shopify-embedded B2B wholesale operating system SaaS. Merchants get: unlimited pricing tiers, spreadsheet-style bulk ordering, self-serve buyer onboarding, automated PDF invoicing, accounts receivable, and BNPL via Resolve.

---

## Non-Negotiable Architecture Decisions

| Decision | Rule |
|---|---|
| Buyer accounts | UNIFIED cross-merchant. One buyer email = one platform account. Per-merchant config lives in `merchant_buyer_relationships`. |
| BNPL | Resolve (US, Phase 1). Always called through `BnplAdapter` interface — never Resolve SDK directly. |
| Billing | Hybrid: flat Stripe subscription + Stripe metered GMV usage records with per-tier free thresholds. |
| Buyer portal | White-label via Shopify App Proxy — buyers see the merchant's Shopify domain only. |
| Multi-tenancy | TWO layers: application `where: { merchantId }` AND PostgreSQL Row-Level Security. Both always active. |
| Price arithmetic | Decimal.js with `ROUND_HALF_EVEN` everywhere. Never native JS floats for money. |
| Financial writes | `$transaction({ isolationLevel: 'Serializable' })` for all order + invoice mutations. |
| External API calls | Every call through an `opossum` circuit breaker. No raw fetch to external services. |
| Launch vertical | Fashion & Apparel only. |

---

## Locked Technology Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 App Router, TypeScript strict |
| UI | Tailwind CSS + shadcn/ui |
| Server state | TanStack Query v5 |
| Client state | Zustand |
| Forms | React Hook Form + Zod (shared schemas on client + server) |
| Backend | NestJS 10, Node.js 20, TypeScript strict |
| API | REST `/api/v1/` + GraphQL (Apollo, code-first) |
| ORM | Prisma 5, PostgreSQL 16 |
| Connection pooling | PgBouncer in transaction mode |
| Cache | Redis 7 — `REDIS_CACHE` (LRU eviction, port 6379) |
| Queue storage | Redis 7 — `REDIS_QUEUE` (AOF + RDB persistence, port 6380) |
| Job queue | BullMQ 5 on REDIS_QUEUE |
| Merchant auth | NextAuth.js v5 + Shopify OAuth 2.0 |
| Buyer auth | RS256 JWT (15 min) + rotating refresh tokens (30 day, persisted to DB) |
| Email | Resend + React Email |
| PDF | `@react-pdf/renderer` (no headless browser, no Puppeteer) |
| Storage | AWS S3 with SSE-KMS, presigned URLs only |
| Billing | Stripe |
| Tracing | OpenTelemetry → OTLP → Grafana Cloud |
| Errors | Sentry (backend + frontend) |
| Logs | Pino (structured JSON, PII masked at emit) |
| Frontend deploy | Vercel |
| Backend deploy | Railway |

---

## Monorepo Layout

```
/
├── apps/
│   ├── web/           # Next.js 14 (merchant admin + buyer portal)
│   └── api/           # NestJS 10 backend
├── packages/
│   ├── shared/        # TypeScript types, Zod schemas, utils (used by both apps)
│   └── database/      # Prisma schema, migrations, generated client
├── tests/
│   ├── e2e/           # Playwright specs
│   └── load/          # k6 load test scripts
├── docs/
│   └── runbooks/      # Ops runbooks
├── CLAUDE.md          # ← this file
├── turbo.json
├── pnpm-workspace.yaml
├── package.json       # root (pnpm workspaces)
├── docker-compose.yml
└── .github/
    ├── workflows/ci.yml
    └── dependabot.yml
```

---

## Database Tables (14 total)

| Table | Purpose |
|---|---|
| `merchants` | One row per Shopify store. `shopifyAccessToken` AES-256-GCM encrypted with key version prefix. |
| `merchant_users` | Staff who access the merchant admin. Roles: owner / admin / staff. |
| `buyers` | Cross-merchant buyer accounts keyed by email. PII fields encrypted. |
| `merchant_buyer_relationships` | Per-merchant buyer config: pricing tier, payment terms, credit limit with optimistic lock (`creditVersion`). |
| `pricing_tiers` | Three types: `percentage_off`, `fixed_price_list`, `volume_breaks`. |
| `pricing_tier_overrides` | Per-product or per-variant price overrides for a tier. |
| `orders` | Shopify orders synced to platform. |
| `order_line_items` | Line items for reconciliation and invoice detail. |
| `invoices` | PDF invoices. `pdfSha256` for integrity. Sequential `invoiceNumber` via DB sequence. |
| `buyer_registration_applications` | Pending/approved/rejected applications per merchant. |
| `webhook_events` | Deduplication + audit record for every inbound Shopify webhook. |
| `refresh_tokens` | Persisted buyer refresh tokens with rotation chain for theft detection. |
| `idempotency_keys` | 24-hour cache for all POST/PATCH responses. |
| `audit_log` | Append-only (PostgreSQL trigger blocks UPDATE/DELETE). |

---

## Security Requirements (All Must Be Implemented)

- **Encryption**: AES-256-GCM with key version prefix (`v{N}:{iv}:{tag}:{ciphertext}`). `CURRENT_ENCRYPTION_KEY_VERSION` env controls active key. Old key versions kept for decryption during rotation.
- **JWT**: RS256. Access token 15 min, carries `jti`. Refresh tokens stored as SHA-256 hash in DB. Rotation attack: if a replaced token is reused, revoke ALL tokens for that buyer.
- **Webhooks**: HMAC-SHA256 signature + timestamp replay prevention (|now − webhookCreatedAt| ≤ 300 s).
- **RLS**: PostgreSQL `app_user` role. App sets `SET LOCAL app.current_merchant_id` per request. Workers set `SET LOCAL app.bypass_rls = 'true'`.
- **Rate limiting**: Per-IP (200/min) + per-merchant by subscription tier (Starter 1K/hr, Growth 5K/hr, Pro 20K/hr). Redis-backed via NestJS ThrottlerModule.
- **Idempotency**: All POST/PATCH read `Idempotency-Key` header. Same key + different body → 422. In-flight duplicate → 409.
- **GraphQL**: Depth ≤ 8. Complexity ≤ 200. Introspection disabled in production. APQ in production.
- **GDPR**: `buyers.anonymizedAt` field. Erasure anonymizes PII, retains financial records.

---

## Code Conventions

```typescript
// ✅ Correct — no any, explicit return types, Decimal for money
async getOrderTotal(orderId: string): Promise<Decimal> {
  const result = await this.prisma.orderLineItem.aggregate({
    where: { orderId },
    _sum: { lineTotal: true },
  });
  return new Decimal(result._sum.lineTotal ?? 0);
}

// ❌ Wrong — any type, implicit return, native float math
async getOrderTotal(orderId) {
  const items = await this.prisma.orderLineItem.findMany({ where: { orderId } });
  return items.reduce((sum, i) => sum + Number(i.lineTotal), 0);
}
```

- All TypeScript files: `"strict": true`, no `any` in business logic
- All prices: `Decimal` type (Prisma + Decimal.js), never `number`
- All DB mutations: wrapped in `$transaction`
- All external API calls: circuit-breaker wrapped
- Logger: import `createLogger` from `packages/shared/utils/logger`, pass `{ correlationId }` on every structured log
- Error codes: snake_case strings exported from `packages/shared/constants/error-codes.ts`
- Pagination: cursor-based only. Never `skip`/`offset`.

---

## Key Environment Variables

```bash
# Database
DATABASE_URL=postgresql://b2bapp:localdev@localhost:5432/b2b_wholesale?schema=public
REDIS_CACHE_URL=redis://localhost:6379
REDIS_QUEUE_URL=redis://localhost:6380

# Auth
NEXTAUTH_SECRET=<32-byte random hex>
AUTH_PRIVATE_KEY=<RS256 PEM>
AUTH_PUBLIC_KEY=<RS256 PEM>

# Encryption
ENCRYPTION_KEY_V1=<64 hex chars = 32 bytes>
CURRENT_ENCRYPTION_KEY_VERSION=1

# Shopify
SHOPIFY_CLIENT_ID=
SHOPIFY_CLIENT_SECRET=

# AWS
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
S3_BUCKET_NAME=
S3_REGION=us-east-1
S3_KMS_KEY_ARN=

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_STARTER_PRICE_ID=
STRIPE_GROWTH_PRICE_ID=
STRIPE_PRO_PRICE_ID=
STRIPE_GMV_METERED_PRICE_ID=

# Email
RESEND_API_KEY=
RESEND_FROM_ADDRESS=invoices@platform.com

# BNPL
RESOLVE_API_KEY=
RESOLVE_WEBHOOK_SECRET=

# Observability
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-prod-us-central-0.grafana.net/otlp
SENTRY_DSN=

# App
ALLOWED_ORIGINS=https://admin.yourdomain.com
PLATFORM_DOMAIN=yourdomain.com
INTERNAL_API_SECRET=<32-byte random hex>
NODE_ENV=development
```

---

## Verification Commands

After each prompt, Claude Code MUST run these before declaring done:

```bash
# After Prompt 1 (Foundation):
pnpm db:generate          # Prisma client generates without error
pnpm typecheck            # Zero TS errors across all packages

# After Prompt 2 (NestJS Core):
pnpm --filter=api build   # NestJS compiles
pnpm typecheck

# After Prompt 3 (Integrations):
pnpm --filter=api test:unit -- --testPathPattern=pricing
pnpm typecheck

# After Prompt 4 (Business Logic):
pnpm --filter=api test:unit
pnpm typecheck

# After Prompt 5 (Frontend + CI/CD):
pnpm --filter=web build   # Next.js builds without error
pnpm typecheck
```

If any verification fails, fix the errors before outputting "done." Do not move to the next prompt until verification passes.
root@localhost:~/wholesale-portal#
