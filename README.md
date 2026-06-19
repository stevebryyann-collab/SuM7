# B2B Wholesale Portal

A financial-grade, Shopify-embedded B2B wholesale operating system (SaaS).
Merchants get unlimited pricing tiers, spreadsheet-style bulk ordering, self-serve
buyer onboarding, automated PDF invoicing, accounts receivable, and BNPL via
Resolve. Launch vertical: **Fashion & Apparel**.

> The single source of truth for architecture decisions is [`CLAUDE.md`](./CLAUDE.md).
> This README is an operational overview; where the two differ, `CLAUDE.md` wins.

---

## Monorepo layout

```
apps/
  web/        Next.js 14 (App Router) — merchant admin + buyer portal
  api/        NestJS 10 — REST + GraphQL, workers, webhooks
packages/
  shared/     TypeScript types, Zod schemas, utils, error codes (@b2b/shared)
  database/   Prisma schema, migrations, generated client (@b2b/database)
tests/
  e2e/        Playwright specs
  load/       k6 load scenarios
docs/
  runbooks/   Operational runbooks
```

Package scope is **`@b2b/*`** (`@b2b/web`, `@b2b/api`, `@b2b/shared`, `@b2b/database`).
Tooling: pnpm workspaces + Turborepo.

## Architecture at a glance

| Concern | Choice |
|---|---|
| Merchant auth | **NextAuth v4 + Shopify OAuth** (HS256 JWT, `NEXTAUTH_SECRET`) — Shopify embedded-app requirement |
| Buyer auth | **Clerk** (`@clerk/backend`) — buyers have no Shopify identity |
| Buyer accounts | UNIFIED cross-merchant; per-merchant config in `merchant_buyer_relationships` |
| Multi-tenancy | App-level `where:{merchantId}` **and** PostgreSQL Row-Level Security (both always on) |
| Money | Decimal.js, `ROUND_HALF_EVEN` — never native floats |
| Financial writes | Prisma `$transaction` with `Serializable` isolation |
| External calls | All wrapped in an opossum circuit breaker |
| Pagination | Cursor-based only |
| BNPL | Resolve, always via the `BnplAdapter` interface |
| Billing | Hybrid: flat Stripe subscription + metered GMV |

### Provider map (locked)

Frontend → **Vercel** · Backend → **Railway** · DB → **Supabase** (Postgres 16 + PgBouncer)
· Cache/Queue Redis → **Railway** · Storage → **AWS S3** (SSE-KMS) · Email → **Resend**
· Payments → **Stripe** · BNPL → **Resolve** · Tracing → **OpenTelemetry → Grafana Cloud**
· Errors → **Sentry** · Logs → **Pino / Better Stack**.

## Local development

```bash
# 1. Local Postgres (Supabase) + Redis
npx supabase init && npx supabase start
docker-compose up -d            # redis-cache (6379) + redis-queue (6380) only

# 2. Install + generate
pnpm install
pnpm db:generate

# 3. Migrate + RLS + seed
pnpm db:migrate
#   then paste packages/database/migrations/003_rls.sql into the local SQL editor
pnpm db:seed

# 4. Run everything
pnpm dev
```

The web app runs on `:3000`, the API on `:4000`.

## Common commands

```bash
pnpm typecheck                       # strict tsc across all packages
pnpm build                           # turbo: nest build + next build
pnpm --filter @b2b/api test          # unit tests (pricing + financial logic)
pnpm test:e2e                        # Playwright (needs a running web server)
k6 run tests/load/catalog.k6.js      # a load scenario
```

## Environment variables

The API validates env at boot (`apps/api/src/config/env.validation.ts`). Required keys
include the database URLs, Redis URLs, Shopify, Clerk, AWS S3, Stripe, Resend, Resolve,
encryption keys, and `NEXTAUTH_SECRET`. The web app additionally needs
`NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `API_BASE_URL`,
`NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `SHOPIFY_CLIENT_ID/SECRET`, `INTERNAL_API_SECRET`,
and `PLATFORM_DOMAIN`. See `CLAUDE.md` → *Environment Variables* for the full list.

> **Build note:** `NEXTAUTH_SECRET` must be a real base64 value (`openssl rand -base64 32`).
> A non-base64 placeholder makes NextAuth fail during `next build` page-data collection.

## CI/CD

GitHub Actions (`.github/workflows/ci.yml`) runs install → lint → typecheck → unit tests →
build → Playwright E2E → Lighthouse budget → security audit (pnpm audit + CodeQL).

## Documentation

- [`docs/deployment-checklist.md`](./docs/deployment-checklist.md)
- [`docs/runbooks/secrets-rotation.md`](./docs/runbooks/secrets-rotation.md)
- [`docs/runbooks/disaster-recovery.md`](./docs/runbooks/disaster-recovery.md)
