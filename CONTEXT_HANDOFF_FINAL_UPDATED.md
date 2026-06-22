# CONTEXT_HANDOFF_FINAL_UPDATED.md

_Generated: 2026-06-16 (Session 4). Updated: 2026-06-16 (Session 5). Supersedes the
Session-3 notes in `CONTEXT_HANDOFF_FINAL.md` for everything below. **Read this first.**_

> **Session 5 TL;DR:** Audited the repo against the Session-4 handoff. The handoff was
> accurate **except** that `apps/web/node_modules` was broken (the web deps — `next`,
> `next-auth`, `@clerk/nextjs` — were in the lockfile/store but **not symlinked**, so
> `pnpm --filter @b2b/web typecheck` actually FAILED with `TS2307 Cannot find module`).
> Session-4's "web typecheck exit 0" was stale (recorded before its own offline lockfile
> regen). Session 5 **repaired the install** (`rm -rf apps/web/node_modules && pnpm install
> --offline`), wrote the one missing file (`docs/deployment-checklist.md`), and re-ran the
> **entire verification gate green**. Prompt 5 is now functionally complete: the only
> not-executed-here items are Playwright/k6 (CI-only — no browsers/k6 binary in this env).
> **Nothing has been committed** — all work is still in the working tree.

---

## ✅ Session 5 — what was done

1. **Audit.** Read both handoffs, ran `git status` + `git log`, and verified every file
   Session 4 claimed exists actually exists. Confirmed `docs/deployment-checklist.md` was the
   one missing file. Confirmed the repo is on branch **`main`** at `53fc4ad` with Prompts 3 & 4
   committed and the Session-3 web frontend (`apps/web/src`) present but uncommitted.
2. **Found & fixed a real blocker the Session-4 handoff missed:** `apps/web/node_modules` was
   missing `next`, `next-auth`, `@clerk/*` (broken symlink state after Session 4's offline
   lockfile churn). `pnpm install --offline` reported "Already up to date" and refused to relink;
   `rm -rf apps/web/node_modules && pnpm install --offline` regenerated the links correctly. No
   lockfile or `package.json` change was needed — the packages were already resolved and in the
   pnpm store.
3. **Wrote `docs/deployment-checklist.md`** (the last open Task-16 item) — a financial-grade
   go-live gate: pre-flight, env-var parity (incl. the `NEXTAUTH_SECRET` web↔API parity trap),
   Supabase/RLS, webhooks & breakers, Vercel headers, a full smoke test, observability/rollback,
   and a Go/No-Go. README + both runbooks were already done.
4. **Re-ran the full verification gate — all green** (see table below).
5. **Validated the "written but not verified" infra** statically: all JSON parses, all k6 scripts
   pass `node --check`, `ci.yml` is well-formed.

---

## Verification status — Session 5 (all run THIS session, against the repaired tree)

| Check | Command | Result |
|---|---|---|
| Prisma client | `pnpm --filter @b2b/database exec prisma generate` | ✅ exit 0 (Prisma 5.19.1) |
| API typecheck | `pnpm --filter @b2b/api typecheck` | ✅ exit 0 |
| API build | `pnpm --filter @b2b/api build` (`nest build`) | ✅ exit 0 |
| Web typecheck | `pnpm --filter @b2b/web typecheck` | ✅ exit 0 *(was FAILING pre-repair)* |
| **Full monorepo** | `pnpm typecheck` (turbo, 4 pkgs) | ✅ **6/6 tasks, exit 0** |
| Web build | `pnpm --filter @b2b/web build` (`next build`) | ✅ **16/16 pages, exit 0** |
| Pricing unit tests | `jest --testPathPattern=pricing` | ✅ **19/19 passed** |
| Frozen lockfile | `pnpm install --frozen-lockfile --offline` | ✅ "Already up to date" |
| Infra files static | JSON parse / `node --check` / YAML | ✅ all valid |

Web build env used (the `NEXTAUTH_SECRET` MUST be real base64 — a dummy fails page-data
collection on `/merchant-login`, which was the entire Session-3 "blocker"):
```bash
export NEXTAUTH_SECRET=$(openssl rand -base64 32) \
  SHOPIFY_CLIENT_ID=test_client_id SHOPIFY_CLIENT_SECRET=shpss_$(openssl rand -hex 16) \
  NEXT_PUBLIC_API_BASE_URL=https://api.example.com \
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_ZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk \
  NEXTAUTH_URL=https://app.example.com PLATFORM_DOMAIN=app.example.com \
  API_BASE_URL=https://api.example.com INTERNAL_API_SECRET=0123456789abcdef0123456789abcdef
```

> **Install repair — important for the next session / fresh clone:** if web typecheck/build
> dies with `TS2307 Cannot find module 'next-auth'` (etc.), the symlinks are broken. Fix:
> `rm -rf apps/web/node_modules && pnpm install --offline`. `.npmrc` points pnpm at
> `registry.npmmirror.com` (the default registry is unreachable here) — keep it for installs.

---

## Repository reality (audited, current)

- Branch **`main`** at `53fc4ad` ("Prompt 4: buyer/merchant APIs, secure GraphQL, BNPL (Resolve),
  Stripe billing"). Prompts 1–4 are **committed**.
- Prompt 5 (web frontend + infra/test/docs) is **complete in the working tree, uncommitted.**
- The Session-1 git snapshot inside `CONTEXT_HANDOFF_FINAL.md` (branch `master` @ `9354bdd`,
  "build broken") is **stale/historical** — ignore it; this file is authoritative.

---

## ✅ COMPLETED (cumulative — Sessions 3–5)

### Web frontend (`apps/web/src`, Session 3)
Full Next.js 14 App Router app: Tailwind design system (skeuomorphic shadow-only per CLAUDE.md),
API client layer, NextAuth (merchant, HS256 via `NEXTAUTH_SECRET`) + Clerk (buyer) wiring, all
UI/shared/feature components (incl. virtualized `BulkOrderTable`, `BuyerApprovalPanel`, Recharts
dashboard), all TanStack Query hooks, every merchant/buyer/auth page, and the edge middleware.
Key constraints to preserve: **package scope is `@b2b/*`**; frontend imports `@b2b/shared/types`
& `@b2b/shared/schemas` only (the barrel is server-poisoned); **buyer pages live under `/portal/*`**;
App-Proxy rewrite is `/apps/wholesale/:path* → /portal/:path*`.

### API-contract gaps closed (Session 4, verified green)
- `GET /buyer/catalog` — `catalog.controller.ts` (NEW) + `catalog.module.ts` wiring.
- `GET /invoices` (merchant; `status`/`buyerId`/`agingBucket`) + `GET /buyer/invoices` — added to
  `invoices.controller.ts` / `invoices.service.ts` (`listInvoicesForMerchant/Buyer`, cursor helpers).
- `GET /buyers/applications?status=` — `buyers.controller.ts` / `buyers.service.ts`
  (`listApplicationsForMerchant`, default `pending`, cap 200).
All confirmed wired this session (routes + module imports present; full build green).

### Task 11 — Vercel/Next config (Session 4, web build green)
- `apps/web/next.config.mjs` extended: `output:'standalone'`, `images.remotePatterns`,
  `serverActions.allowedOrigins`, env passthrough, rewrite `/apps/wholesale/:path* → /portal/:path*`.
- `apps/web/vercel.json` (NEW): CSP (Clerk domains), HSTS, `X-Frame-Options: DENY`/`frame-ancestors
  'none'`, COOP/CORP, `Permissions-Policy`. (COEP omitted — breaks Clerk; X-Frame DENY safe because
  OAuth is redirect-based, not embedded App Bridge.)

### Task 16 — docs (NOW COMPLETE)
- `README.md` (rewritten), `docs/runbooks/secrets-rotation.md`, `docs/runbooks/disaster-recovery.md`,
  and **`docs/deployment-checklist.md` (NEW this session)**.

### Tasks 12–15 — infra/tests (present; statically valid; executed only in CI)
- `.github/workflows/ci.yml` (8 jobs), `.github/dependabot.yml`.
- `.lighthouse-budget.json` + `.lighthouserc.json`.
- `tests/load/{catalog,order-creation,invoice-download}.k6.js`.
- `playwright.config.ts` + `tests/e2e/{global-setup,global-teardown,auth,merchant,buyer}.spec.ts`.
- Root `package.json` `test:e2e` (→ `pnpm dlx playwright@1.47.2 test`) / `test:load` scripts.

---

## ❌ REMAINING WORK (resume here, in order)

1. **Commit.** Nothing in Prompt 5 has been committed. Suggested: branch off `main`, commit the
   web frontend + API gap fixes + infra/docs, open a PR. (Per repo convention, commit only when
   the user asks — this session did not, by default.)
2. **Run Playwright + k6 in CI** (or an env with browsers/the k6 binary). They are syntactically
   valid and CI-wired but were never **executed** — `auth.spec.ts` (redirects/public pages) should
   pass without creds; `merchant`/`buyer` specs skip without auth fixtures.
3. **Deferred schema work (CLAUDE.md FINAL STATE — pre-existing, never this build's scope):**
   buyers `passwordHash`/`loginFailCount`/`lockedUntil` removal; `merchant_users` password/mfa
   restoration; Prompt 4's `'defaulted'` `InvoiceStatus`. Migration 004 (`drop clerk_org_id`)
   authored, **not applied** (no live DB in this environment). Confirm intent with the user before
   touching — it cascades into `seed.ts` + `merchants.service.ts`.
4. **No live DB here** — all DB/RLS verification is typecheck-only. Apply migrations + `003_rls.sql`
   on a real Supabase project before any deploy (see `docs/deployment-checklist.md` §2).

---

## Files touched — Session 5
- **NEW:** `docs/deployment-checklist.md`.
- **MODIFIED:** `CONTEXT_HANDOFF_FINAL_UPDATED.md` (this file).
- **INSTALL REPAIR (not a file edit):** `apps/web/node_modules` regenerated via reinstall.
- Carried over uncommitted from Sessions 3–4 (see `git status`): `apps/web/src/`, `apps/web/*.{ts,mjs,json}`,
  `apps/api/src/catalog/catalog.controller.ts` + the invoices/buyers/catalog edits, `.github/workflows/`,
  `tests/`, `docs/`, `playwright.config.ts`, `.lighthouse*.json`, root `package.json`, `pnpm-lock.yaml`,
  `README.md`, `.claude/settings.local.json`, `next-env.d.ts`.

---

## Exact next steps (copy/paste)
```bash
cd /root/wholesale-portal

# If web typecheck/build fails with "Cannot find module 'next-auth'": repair the install
rm -rf apps/web/node_modules && pnpm install --offline

# Verification gate (all green as of Session 5):
pnpm --filter @b2b/database exec prisma generate
pnpm typecheck                                   # turbo, 4 pkgs → 6/6
pnpm --filter @b2b/api build                     # nest build
pnpm --filter @b2b/api exec jest --testPathPattern=pricing   # 19/19
# web build needs the realistic env block above, then:
pnpm --filter @b2b/web build                     # 16/16 pages

# Then: commit Prompt 5, run Playwright/k6 in CI, decide on deferred schema work.
```
