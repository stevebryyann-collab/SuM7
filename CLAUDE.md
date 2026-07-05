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

# WHOLESALE PORTAL DESIGN SYSTEM
## Apple Weather Inspired Premium Glass Design Language

---

# Core Philosophy

Wholesale Portal is not enterprise software that feels cold.

It is a premium Shopify application that feels calm, elegant,
and effortless while handling extremely complex wholesale workflows.

Every page should feel like looking through glass into a peaceful sky.

The interface should reduce stress while managing large catalogs,
bulk orders, invoices, receivables and analytics.

The visual language is inspired by Apple's Weather application.

The experience must feel alive without becoming distracting.

Every page should belong to the exact same design system.

There should never be a page that feels like it was designed by
a different person.

If two screenshots are placed side by side,
they should obviously belong to the same application.

---

# Design Principles

Elegant

Airy

Premium

Soft

Calm

Organic

Fluid

Highly readable

Content first

Beautiful second

Animations never exist for decoration.

Animations always explain.

---

# Visual Identity

The application always feels like morning.

Large atmospheric gradients.

Blue skies.

Soft mint.

Cloud white.

Subtle light.

Never harsh.

Never dark unless dark mode exists.

No corporate gray dashboards.

No Bootstrap.

No Material UI.

No Shopify Polaris visual style.

---

# Background System

Every page uses an atmospheric background.

The background never feels static.

Use layered gradients.

Large blurred cloud shapes.

Subtle animated movement.

Very slow.

Movement should almost not be noticeable.

Animation duration

20s–40s

Ease-in-out

Infinite alternate

Never distracting.

Never looping aggressively.

---

# Glass System

Every surface is glass.

Cards

Navigation

Sidebar

Modal

Dropdown

Popover

Search

Filter menus

Tables

Charts

Everything.

Glass recipe

background:
rgba(255,255,255,0.72)

backdrop-filter:
blur(28px)

border:
1px solid rgba(255,255,255,.85)

Large soft shadow

No heavy borders.

No flat white cards.

---

# Corner Radius

Primary cards

28px

Secondary cards

22px

Buttons

16px

Inputs

16px

Modal

32px

Small chips

9999px

Everything should feel soft.

Never sharp.

---

# Shadows

Soft.

Wide.

Diffuse.

Never harsh.

Cards appear to float.

Hover slightly increases shadow.

Never black shadows.

Always use blue-gray shadows.

---

# Color Palette

Ocean Blue

Primary actions

Sky Blue

Highlights

Mint Green

Success

Cloud White

Glass

Fog Gray

Secondary text

Coral

Danger

Amber

Warning

Only these colors exist.

Never introduce random accent colors.

---

# Typography

Inter

Large headings

Very bold

Body

Regular

Labels

Medium

Large spacing between sections.

Very generous whitespace.

Never cram content together.

---

# Navigation

Sidebar is translucent glass.

Floating.

Soft blur.

Navigation items have:

hover glow

slight background tint

left indicator

spring animation

Selected navigation softly glows.

Never harsh blue blocks.

---

# Buttons

Primary buttons

Gradient

Ocean Blue

Soft glow

Rounded

Lift slightly on hover

Spring animation

Hover

translateY(-2px)

Pressed

scale(.97)

150ms spring

Secondary buttons

Glass

Transparent

Border

Hover tint

Ghost buttons

Transparent

Text only

Hover background

---

# Forms

Inputs are glass.

Soft border.

Placeholder uses fog gray.

Focus state

Blue border

Soft outer glow

No browser outlines.

Dropdowns

Same glass.

Autocomplete

Same glass.

Everything consistent.

---

# Tables

Tables are floating glass surfaces.

Rows

Large enough to breathe.

Hover

Soft blue tint.

Selected row

Ocean blue tint.

Rounded table container.

Never spreadsheet styling.

---

# Cards

Every card floats independently.

Hover

Lift 2–4px

Shadow increases

Animation

250ms spring

Cards never jump.

Cards glide.

---

# Charts

Charts are elegant.

Rounded.

Soft gradients.

Minimal grid lines.

Large numbers.

Lots of whitespace.

Charts should feel like Apple's Health app.

---

# Icons

Thin stroke icons.

Rounded ends.

Never filled icons unless required.

Consistent stroke width.

---

# Animations

Everything animates.

Page transitions

Fade

Slide

Scale

Navigation transitions

250–350ms

Spring easing

Cards

Fade upward

12px

Modals

Scale

Opacity

Blur

Dropdowns

Fade

Scale

Buttons

Spring

Hover

Lift

Pressed

Scale

Nothing appears instantly.

Nothing disappears abruptly.

Everything feels alive.

---

# Page Transitions

Changing pages should never flash.

Old page

Fades

Moves upward

New page

Fades in

Moves upward

Duration

300ms

Spring easing.

The transition should feel almost identical to Apple's Weather app.

---

# Loading States

Skeletons

Glass

Shimmer

Rounded

Never spinners unless absolutely necessary.

---

# Empty States

Large illustration

Soft colors

Friendly message

Primary CTA

Never blank pages.

---

# Modals

Blur background.

Scale animation.

Glass container.

Large spacing.

Rounded corners.

Soft shadow.

---

# Notifications

Floating glass toast.

Slides from top right.

Soft blur.

Auto dismiss.

---

# Buyer Portal

Uses exactly the same design language.

Never looks different from Merchant Portal.

Only the workflow changes.

Not the visual language.

---

# Landing Page

Uses the exact same design language.

Atmospheric sky.

Floating hero.

Glass navigation.

Floating pricing cards.

Glass feature cards.

Beautiful animations.

Looks like a premium Apple product page.

---

# Consistency Rules

Every page must use

✔ Same spacing

✔ Same shadows

✔ Same typography

✔ Same animation speed

✔ Same blur

✔ Same gradients

✔ Same glass

✔ Same radius

✔ Same colors

No exceptions.

---

# Absolutely Forbidden

Bootstrap appearance

Material UI appearance

Flat dashboards

Corporate admin templates

Dark borders

Heavy shadows

Rectangular cards

Tiny spacing

Abrupt animations

Instant page changes

Random colors

Random border radius

Pages with different visual styles

Components that don't match the design system

Anything that breaks the Apple Weather visual language

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

Package scope in this repo is **`@b2b/*`** (`@b2b/api`, `@b2b/web`, `@b2b/shared`,
`@b2b/database`) — not `@wholesale-portal/*`. Use `@b2b/*` in every filtered command
below; the original build prompts used the wrong scope.

After any backend change:
  pnpm --filter=@b2b/api build
  pnpm typecheck

After pricing or financial logic:
  pnpm --filter=@b2b/api test:unit -- --testPathPattern=pricing
  pnpm typecheck

After any frontend change:
  pnpm --filter=@b2b/web build
  pnpm typecheck

After schema changes:
  pnpm db:generate
  pnpm typecheck

Full verification (run before declaring any prompt done):
  pnpm typecheck

Zero errors required. Do not proceed until verification passes.

---

## PARTS 1–4 OF 4 COMPLETED

The full build (design-system foundation → buyer features → merchant admin →
polish) is done. Full per-file detail lives in the three implementation docs;
this section is the consolidated reference so a fresh session doesn't have to
re-derive it from git history.

| Part | Scope | Doc |
|---|---|---|
| 1 | Design-system foundation: tokens (`tailwind.config.ts` + `globals.css`), `DataTable`, `StatusBadge`, `DashboardKpiCard`, `Sidebar`, `PageLayout`, `EmptyState`, `ConfirmDialog`, typed `toasts`, all 13 merchant pages wired to `PageLayout` | `CONTEXT_HANDOFF.md` |
| 2 | Buyer features: inventory visibility, shopping lists, discount codes (backend only, no admin UI), GA4/GTM analytics | `PART_2_IMPLEMENTATION.md` |
| 3 | Merchant admin: sales-rep portal, fulfillment tracking + shipping emails, standing-order reminders, settings analytics tab, full design-system reskin of dashboard/orders/invoices/buyers/analytics | `PART_3_IMPLEMENTATION.md` |
| 4 | Polish: micro-interactions, invoice PDF redesign, GMV-milestone + first-buyer-approval celebrations, system health dashboard, pricing table redesign, `FadeIn` page-load choreography, Playwright visual-consistency suite | `PART_4_IMPLEMENTATION.md` |

Note: a separate design-system rollout was originally planned as its own
"Parts 2–4" (see `CONTEXT_HANDOFF.md` → NOT DONE) but never shipped as
standalone prompts. That reskin work landed instead inside Part 3's session 2
(orders/invoices/buyers/analytics onto `DataTable`) and Part 4 (`FadeIn` +
the pricing table rebuild). Do not go looking for a separate "design-system
Part 2" branch or doc — it doesn't exist; the work is folded into Parts 3–4.

### New database tables / columns added since the schema in this file
- `shopping_lists`, `shopping_list_items`, `b2b_discount_codes` (migration 008)
- `merchants.gtmId`, `merchants.ga4Id`, `merchants.allowsBackOrders` (migration 009)
- `sales_rep` value on the merchant-role enum, `sales_rep_sessions` table (RLS'd), `orders.rep_session_id` (migration 010)
- `orders.tracking_number`, `orders.tracking_url`, `orders.fulfillment_service`, `orders.shipped_at`, `orders.estimated_delivery_at` (migration 011)
- `standing_orders` (migration 012 — **no RLS**, same reasoning as `shopping_lists`: buyer-portal handlers run without a tenant context, so RLS would fail those reads closed; isolation is app-layer `where:{buyerId,merchantId}`)
- No new environment variables were added across Parts 2–4.

### Net-new frontend components/hooks worth knowing about
`DataTable` family, `DropdownMenu` (dependency-free, portals out of
`overflow-hidden` tables so row menus are never clipped), `FadeIn`,
`CopyButton` + `useCopyToClipboard`, `GmvMilestoneToast`, `FirstUseWelcome`,
`RepSessionBanner`, the system health dashboard (`useHealth.ts` +
`/settings/health`), `useStandingOrders`.

### Design-system enforcement (binding, not aspirational)
- Tokens in `tailwind.config.ts` / `globals.css` are the *only* source of
  color, shadow, radius, and duration values — no hardcoded hex, no arbitrary
  Tailwind values, no shadow outside the token scale.
- Every financial/money-value cell renders with `tabular-nums` (enforced by
  `DataTable`'s `align="right"`, spot-checked by
  `tests/e2e/visual-consistency.spec.ts`).
- Status badges are soft solid-fill chips (tinted fill + matching-hue label),
  never transparent — spot-checked by the same Playwright spec.
- The glass system must be present: cards, navigation, sidebar, modals, tables
  and toasts are translucent Cloud White over `backdrop-filter: blur(28px)`.
  Interactive elements lift/press with spring transforms; shadows are soft,
  wide, blue-gray, and may layer. `visual-consistency.spec.ts` asserts (via
  computed style) that glass surfaces are actually rendered — the inverse of the
  old minimalist rule that forbade blur/transforms.

### Competitive positioning (why GMV-milestone messaging exists)
The platform's core pitch versus marketplace alternatives (Faire, etc.) is
**zero marketplace commission** — merchants keep 100% of GMV processed
through their own wholesale channel instead of paying a ~15% marketplace
take rate. `GmvMilestoneToast` reinforces this at $1K/$10K/$50K/$100K/$500K
lifetime GMV by stating the dollar amount of commission the merchant would
have paid Faire and didn't. This is a retention/expansion lever, not
decoration — preserve the commission-comparison framing if these thresholds
or messages are ever revised.

### Verification (last run at the Part 4 handoff, 2026-07-02)
```
pnpm typecheck                       # 6/6 successful
pnpm --filter @b2b/api build         # ok
pnpm --filter @b2b/web build         # exit 0, 30/30 routes (25 static)
```

---

Last updated: Parts 1–4 of 4 complete (see PARTS 1–4 OF 4 COMPLETED above).
Hybrid auth locked — NextAuth v4 + Shopify OAuth for merchants (Shopify
embedded app requirement), Clerk for buyers. Supabase replaces Railway
PostgreSQL. buyers table cleaned of Clerk-owned auth fields. refresh_tokens
table removed. emailVerifiedAt synced via Clerk user.updated webhook.
Design language is the Apple-Weather premium glass system (see "WHOLESALE PORTAL
DESIGN SYSTEM" above): atmospheric morning-sky background, translucent glass
surfaces over blur, soft blue-gray floating shadows, large radii, spring
lift/press animations. The former flat-minimalist system (no blur, no gradients,
no transforms, shadow-only press) has been fully replaced — do not reintroduce
it. Verification commands use the real `@b2b/*` package scope, not
`@wholesale-portal/*`.
