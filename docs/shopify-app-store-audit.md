# Shopify App Store Readiness Audit — Wholesale Portal

_Grounded audit against the Shopify App Store review checklist. Every finding is
tied to real files. Audit method: 4 lanes run by parallel subagents
(oauth, embedded/App-Bridge, webhooks, GDPR) + 8 lanes audited inline against
source (security, accessibility, performance, UX, billing, testing,
wholesale-features, listing/production). Date: 2026-07-09._

---

## 1. Executive summary

**Not submittable today — but the blockers are concentrated, not systemic.**

The backend is genuinely strong: OAuth 2.0 + PKCE + state, all seven required
business webhooks and all three mandatory GDPR/compliance webhooks (HMAC-verified,
idempotent, wired to real workers), AES-256-GCM encryption of the Shopify token and
buyer PII, RLS multi-tenancy, Decimal.js money, circuit-breaker + leaky-bucket rate
limiting, and a real Shopify draft-order checkout path. Onboarding, billing UX, and
legal pages are present and substantive.

The app is blocked by **one fundamental contradiction**: `shopify.app.toml` declares
`embedded = true`, but the web app is a standalone, cookie-authenticated Next.js app
that (a) is served with `X-Frame-Options: DENY` and CSP `frame-ancestors 'none'`, so
a browser will hard-refuse to render it inside `admin.shopify.com`, and (b) has no
App Bridge and no session-token auth, so even if it could be framed, its
`SameSite=Strict` cookies are third-party in the iframe and won't be sent. **As
configured, the embedded app cannot load in Shopify Admin.** That is an automatic
rejection and must be resolved before anything else.

Second decision point: **billing runs on Paddle, not the Shopify Billing API.** This
is a locked architectural choice, but it collides with Shopify App Store policy and
needs an explicit owner decision (details in §3).

Everything else is gaps and polish, not blockers.

---

## 2. Review blockers (must fix before submission)

Ranked most-fundamental first.

| #   | Item                                           | Domain           | Why it blocks                                                                                                                                                                                     | Remediation                                                                                                                                                    | Effort  |
| --- | ---------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | `X-Frame-Options: DENY` on every route         | embedded         | Browser refuses to frame the app in Shopify Admin; embedded app renders blank. XFO has no per-origin allow-list.                                                                                  | Remove XFO from `apps/web/vercel.json` for embedded routes; rely on `frame-ancestors` CSP instead.                                                             | trivial |
| 2   | CSP `frame-ancestors 'none'` on every route    | embedded         | Forbids `admin.shopify.com`/`*.myshopify.com` from framing; embedded app blocked.                                                                                                                 | Emit per-shop `frame-ancestors https://<shop>.myshopify.com https://admin.shopify.com` at runtime (middleware), not static `'none'` in `vercel.json:10`.       | small   |
| 3   | No App Bridge library / script                 | embedded         | Shopify requires embedded apps to load App Bridge (session tokens, host context, in-Admin nav). None present in `apps/web`.                                                                       | Load `https://cdn.shopify.com/shopifycloud/app-bridge.js` in the `(merchant)` route-group `<head>` with the app `client_id`; initialize with the `host` param. | large   |
| 4   | Session-token auth missing (cookie-only)       | embedded / oauth | Merchant auth is `SameSite=Strict` NextAuth cookies (`auth-options.ts:154-166`); third-party in the iframe, blocked by Chrome/Safari defaults. App bounces to `/merchant-login` inside the frame. | Fetch App Bridge session token, send as `Authorization: Bearer`, verify against Shopify JWKS in a NestJS guard (token-exchange for the Admin token).           | large   |
| 5   | `host` param + embedded navigation not handled | embedded         | Embedded apps receive a base64 `host` param needed to init App Bridge and keep nav inside the frame; not captured anywhere. Server redirects (`middleware.ts`) frame-bust.                        | Capture `host`+`shop` on entry, init App Bridge with it, use App Bridge navigation / preserve params on links.                                                 | large   |
| 6   | Auto-OAuth on embedded entry missing           | oauth            | Embedded load with `shop`/`host` and no session lands on a manual login form instead of starting OAuth — diverges from expected embedded install.                                                 | On the merchant entry route, auto-invoke `signIn('shopify',{shop})` when a valid `shop` is present and no session exists.                                      | small   |
| 7   | Paddle billing vs. Shopify Billing API         | billing          | Shopify policy generally **requires** charging for app access via the Shopify Billing API. Paddle-as-MoR is an exception path that is scrutinized and can be rejected.                            | Owner decision — see §3.                                                                                                                                       | large   |

Items 1–6 are all facets of the single "embedded app doesn't actually work embedded"
problem. They should be fixed together as one workstream.

---

## 3. Architectural conflicts needing an owner decision

### 3a. Embedded app model (blockers 1–6)

**What Shopify requires:** An embedded app must (1) be frameable by
`admin.shopify.com`/`*.myshopify.com` via `frame-ancestors`, and (2) authenticate
with App Bridge **session tokens**, because first-party cookies are third-party
inside the Admin iframe and are blocked by default.

**What the code does:** `embedded = true` in `shopify.app.toml`, but `vercel.json`
blocks all framing and merchant auth is `SameSite=Strict` cookies with no App Bridge.

**Options:**

- **A — Go truly embedded (recommended for App Store fit).** Add App Bridge + session
  tokens + `host` handling; fix framing headers; verify session tokens against Shopify
  JWKS on the API. Highest effort, but it's what "embedded Shopify app" means and what
  reviewers expect. _Effort: large._
- **B — Ship non-embedded.** Set `embedded = false`; the admin runs top-level where the
  existing first-party cookie model works as-is. Fastest path to a working, approvable
  app; loses the in-Admin experience. Only headers + toml change. _Effort: small._
- **C — Hybrid.** Non-embedded now (Option B) to unblock submission, embedded as a
  fast-follow (Option A). Pragmatic if time-to-submit matters.

CLAUDE.md itself asserts the backend "must verify [App Bridge tokens] against Shopify's
public JWKS endpoint" — that path does not exist yet, so the locked design already
assumes Option A but hasn't implemented it. This needs an explicit call.

### 3b. Billing provider (blocker 7)

**What Shopify requires:** Apps charging merchants for app access must generally use
the Shopify Billing API. Merchant-of-record/external billing exists for some models
but is reviewed carefully and is a common rejection reason.

**What the code does:** Full Paddle implementation (`billing.service.ts`) — flat tier
price + monthly GMV overage one-time charges, hosted checkout, customer portal,
dunning→suspend, trial via `merchant.trialEndsAt`. Well-built, but not Shopify Billing.

**Options:**

- **A — Keep Paddle, argue the exception.** Prepare the merchant-of-record
  justification for review; accept rejection risk. Zero code change.
- **B — Move app-subscription to Shopify Billing API,** keep Paddle only for
  buyer-facing/BNPL flows Shopify doesn't govern. Aligns with policy; large rewrite of
  the subscription/overage path.
- **C — Confirm with Shopify Partner support** which path your specific model qualifies
  for before building. Cheapest first step; do this regardless.

Do not assume Paddle passes. Get a ruling first.

---

## 4. Gaps by domain (PARTIAL / MISSING)

### Embedded / App Bridge

All items MISSING/CONFLICT — see blockers 1–6. Nothing DONE in this domain.

### OAuth / Fundamentals

**DONE: 10 items** (OAuth 2.0, PKCE+state, SSRF-safe shop validation, min scopes,
encrypted token at rest, session security, uninstall cleanup, HMAC, internal endpoint
guard, offline token). Gaps:

- _Installs into Admin (auto-OAuth)_ — PARTIAL, see blocker 6. _small._
- _Revoked token retention_ — access token retained until the 90-day purge rather than
  nulled on uninstall. Optional hardening: null `shopify_access_token` in
  `merchant-cleanup.worker.ts`. _small._
- _Callback `hmac` param_ — not independently verified (state+PKCE cover CSRF).
  Optional defense-in-depth. _small._

### Webhooks

**DONE: 10 items** (all 7 required topics registered+handled+wired, HMAC, retry/backoff,
logging, all queues have consumers). Gap:

- _Idempotency edge_ — `shopifyEventId` defaults to `''` when `x-shopify-webhook-id`
  is absent, so two id-less deliveries from one shop collide on the unique key and the
  second is dropped. Reject empty webhook-id in the guard, or hash the raw body.
  _trivial._

### GDPR

**DONE: 8 items** (all 3 mandatory webhooks wired to real redaction/purge workers,
privacy + terms pages, merchant-initiated erasure). Gaps:

- _Merchant-wide `type=gdpr` export is a stub_ — returns 202 "we'll email you" but
  enqueues nothing; no worker/email exists. **False promise — fix or remove the
  response.** _medium._
- _Subject-access export omits the buyer's own `taxId`/`phone`_ — arguably incomplete
  under GDPR right-of-access. Include decrypted PII (or justify omission). _small._
- _`shop/redact` retains recent webhook_events_ — only deletes rows older than 90 days;
  delete all for the domain on shop redact. _small._
- _Legal-entity placeholders_ in privacy/terms — fill before submission. _trivial._

### Security

**DONE:** Strong headers (HSTS preload, nosniff, COOP/CORP, Permissions-Policy),
`upgrade-insecure-requests`, hardened cookies, AES-256-GCM key-versioned encryption of
Shopify token + buyer PII, constant-time internal-secret compare, env validated at
boot. **Demo backdoor is safe:** `isDemoEnabled()` = `NODE_ENV !== 'production'`,
inlined by Next at build so demo provider/branches are dead-code-eliminated in prod
(`apps/web/src/lib/dev/demo.ts:61-68`) — no production auth bypass. Gap:

- The framing headers (blockers 1–2) are the only real security-config change needed,
  and it _loosens_ framing for embedded routes only — scope XFO/CSP so non-embedded
  routes keep clickjacking protection. _small._

### Performance / API usage

**DONE:** `shopify-api.service.ts` is exemplary — leaky-bucket tracking of
`X-Shopify-Shop-Api-Call-Limit` (throttle flag at 80%), 429 + `Retry-After` honoring,
exponential backoff with jitter, shared circuit breaker, cursor-paginated
`listProducts`, Bulk Operations API for large syncs, all sync work in BullMQ workers.
Frontend uses cursor pagination, TanStack Query, virtualization, and loading skeletons.
No blockers. (Minor: confirm the GIN trigram index on `buyers.company_name` is present
in migrations — claimed in CLAUDE.md.)

### UX / Error handling

**DONE:** Real onboarding wizard with genuine completion signals
(`hasTier`/`hasApprovedBuyer`/`hasSubscription`), never a dead-end (always a
"Skip to dashboard" escape), progress bar over required steps. Full route boundary set
exists: `error.tsx`/`loading.tsx`/`not-found.tsx` per route group +
`global-error.tsx`. Toasts, empty states, confirm dialogs, loading skeletons present.
No blockers — but note the embedded blockers mean a reviewer can't _reach_ this UX in
Admin until §3a is resolved.

### Billing UX (provider-agnostic)

**DONE:** Clear pricing (three tiers with price/free-tier/rate/features), trial state
surfaced, GMV usage meter, plan comparison, change/confirm modals, "Manage billing"
opens the Paddle customer portal (self-serve cancel). Pricing/trial/cancellation UX is
complete regardless of the §3b provider question.

### Logging / Monitoring / Testing

**DONE:** Sentry across API (incl. `main.ts`), OpenTelemetry tracing, pino structured
logging, audit*log on financial state changes, worker dead-lettering. **Gap — test
coverage is thin for a "financial-grade" app.** Only 4 API spec files exist
(`billing`, `pricing`, `compliance-webhooks`, `gdpr-compliance.worker`) + 4 Playwright
specs + 3 k6 scripts. **No tests for: orders, invoices/PDF, BNPL/Resolve adapter,
catalog-sync, the auth guards (merchant-session, clerk-buyer), or the Shopify API
retry/rate-limit layer.** Not a hard review blocker, but a real risk for the money
paths. \_medium–large to close.*

### Wholesale features

**DONE:** Product/variant sync (webhooks + Bulk API), tiered pricing
(percentage/fixed-list/volume-break with priority + per-buyer overrides), buyer
approval + payment terms + credit visibility, **real Shopify draft-order checkout**
(`createDraftOrder`/`completeDraftOrder` → `write_orders`), PDF invoicing, AR aging,
analytics (GMV trend/top buyers), BNPL via Resolve adapter. Gaps to verify:

- _Collections sync_ — not confirmed present in `catalog/`; grep to confirm
  DONE/MISSING. _small if missing._
- Inventory webhook currently cache-invalidates only (documented as intentional).

### Listing / Legal / Production

**DONE (operational):** README, deployment checklist, DR + secrets-rotation runbooks,
real privacy + terms pages, RLS multi-tenancy, queue workers, caching, CDN (Vercel),
Sentry/OTel monitoring. **MISSING (non-code deliverables — expected):** app icon,
banner, screenshots, feature graphics, listing copy, FAQ, changelog — all created in
the Partner Dashboard, not the repo. Gaps to verify:

- _Support contact_ — confirm a support email/URL appears in-app or on legal pages;
  Shopify requires one. _trivial to add if missing._
- Replace `client_id` / `<APP_URL>` / `<API_URL>` placeholders in `shopify.app.toml`
  before `shopify app deploy`. _trivial._
- Complete the **Protected Customer Data** request in Partner Dashboard (triggered by
  `read_customers`). _operational._

---

## 5. What's already solid (do not touch)

- **OAuth + token security:** authorization-code + PKCE + state, SSRF-safe per-shop
  domain validation, offline token encrypted at rest with key versioning.
- **Webhooks:** all 7 required business topics + all 3 mandatory GDPR topics, HMAC
  (constant-time, raw-body, replay window), idempotency, retry/backoff, workers.
- **GDPR redaction/purge workers:** real anonymization across the cross-merchant model,
  financial-record retention, Serializable transactions.
- **Shopify API client:** rate-limit aware, backoff, circuit breaker, cursor pagination,
  Bulk Operations — genuinely production-grade.
- **Money engine:** Decimal.js ROUND_HALF_EVEN pricing with tiers/overrides/volume
  breaks; atomic idempotent GMV overage billing.
- **Onboarding + error boundaries:** real completion signals, no dead-ends, full
  error/loading/not-found coverage.
- **Security posture:** strong headers, encrypted PII, no prod auth bypass, demo mode
  statically eliminated in production builds.

---

## 6. Recommended remediation sequence

**Phase A — Unblock submission (do first):**

- A1. Decide the embedded model (§3a: Option A full-embedded, B non-embedded, or C
  hybrid). _decision._
- A2. Fix framing headers — scope/remove `X-Frame-Options: DENY` and replace
  `frame-ancestors 'none'` with per-shop values for embedded routes. _trivial–small._
- A3. If Option A/C: add App Bridge script + `host` capture + session-token auth +
  JWKS verification guard + auto-OAuth on entry. _large._
- A4. Decide billing provider (§3b) — at minimum, confirm with Shopify Partner support
  before building. _decision._
- A5. Fix the GDPR merchant-export stub (implement or remove the false 202). _medium._

**Phase B — High-value gaps:**

- B1. Add tests for the money paths: orders, invoices, BNPL, catalog-sync, auth guards,
  Shopify retry layer. _medium–large._
- B2. Include buyer's own `taxId`/`phone` in subject-access export. _small._
- B3. Confirm/implement collections sync. _small._
- B4. Confirm a support contact is present in-app/legal. _trivial._
- B5. Null the Shopify access token on uninstall. _small._

**Phase C — Polish:**

- C1. Reject empty `x-shopify-webhook-id` in the HMAC guard. _trivial._
- C2. `shop/redact` — delete all webhook*events for the domain regardless of age. \_small.*
- C3. Fill legal-entity + toml placeholders; complete Protected Customer Data request;
  prepare listing assets (icon/banner/screenshots/FAQ/changelog). _operational._

---

_Note on verification: 4 lanes (oauth, embedded, webhooks, gdpr) were produced by
parallel subagents with full file-level citations; the other 8 were audited inline
against source in this session. Two low-risk items (collections sync presence, support
contact presence) are flagged "verify" rather than asserted, pending a one-line grep._
