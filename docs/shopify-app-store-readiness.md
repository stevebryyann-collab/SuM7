# Shopify App Store — Readiness Audit & Roadmap

_Last updated: 2026-07-08. Evidence-based gap analysis of `wholesale-portal` against the
Shopify App Store review checklist. Every finding cites a file read from the repo._

## Verdict

The engineering substrate is strong (rate-limit-aware Shopify client, circuit breakers,
field encryption, hardened cookies, cursor pagination, immutable audit log). But the app is
**not yet submittable** — it is missing the pieces that make it a _Shopify_ app rather than a
standalone SaaS that talks to Shopify. Four hard blockers, several high-risk gaps.

## Rejection-risk summary

| ID  | Finding                                                                                               | Risk       | Decision-independent?            |
| --- | ----------------------------------------------------------------------------------------------------- | ---------- | -------------------------------- |
| B1  | Mandatory GDPR webhooks (`customers/data_request`, `customers/redact`, `shop/redact`) not implemented | 🔴 Blocker | Yes — in progress                |
| B2  | No webhook **registration** with Shopify (handlers exist, nothing subscribes them)                    | 🔴 Blocker | Partly (mechanism depends on B3) |
| B3  | Not a technically-embedded app — no App Bridge / session tokens / iframe CSP                          | 🔴 Blocker | **No — needs owner decision**    |
| B4  | Billing via Paddle, not Shopify Billing API                                                           | 🔴 Blocker | **No — needs owner decision**    |
| B5  | OAuth install flow doesn't validate Shopify request HMAC / `host`                                     | 🟠 High    | Ties to B3                       |
| B6  | No merchant onboarding (no welcome/setup/wizard route)                                                | 🟠 High    | Yes                              |
| B7  | Missing `customers/update` + `inventory_levels/update` handlers                                       | 🟠 High    | Yes (with B2)                    |
| B8  | Protected Customer Data (PCD) approval not yet obtained                                               | 🟠 High    | Partner Dashboard (paperwork)    |
| B9  | No in-repo privacy policy / ToS; listing legal assets                                                 | 🟠 High    | Yes                              |
| —   | A11y/contrast of glass UI, financial-logic test coverage, perf profiling                              | 🟡 Medium  | Yes (deeper pass pending)        |

## Blocker detail

### B1 — Mandatory GDPR/compliance webhooks (IN PROGRESS)

`apps/api/src/webhooks/webhooks.controller.ts` handles orders/products/`customers/create`/
`app/uninstalled` — but **none** of the three Shopify-mandatory compliance topics. An internal
buyer export/erase pipeline exists (`buyers.service.ts:1314` `getBuyerGdprExport`, `:1425`
`eraseBuyer`; `merchant-purge-data.worker.ts` `MerchantPurgeService`) but is not wired to
Shopify's required endpoints. Missing these is an automatic rejection.

**Design (being implemented):** a dedicated `ComplianceWebhooksController` that verifies HMAC
**inline** (NOT via `WebhookHmacGuard`, whose Check 3 requires an _active_ merchant — but
`shop/redact` fires 48h after uninstall and `customers/redact` can arrive post-uninstall, so
the merchant may be inactive/gone). Each endpoint: verify HMAC (401 on fail) → idempotently
record into `webhook_events` → enqueue fulfillment → 200.

- `shop/redact` → resolve merchant by domain, enqueue `JOB_MERCHANT_PURGE_DATA` (reuses
  existing `MerchantPurgeService`).
- `customers/data_request` → record + audit; merchant fulfills via existing GDPR export UI.
- `customers/redact` → **unified-buyer nuance (see Decisions):** anonymize the global buyer
  only when this merchant is its sole relationship; otherwise unlink the merchant-buyer
  relationship and audit, retaining the shared identity + financial records (7-yr obligation).

### B2 — No webhook registration

No `webhookSubscriptionCreate`, no REST `webhooks/create`, no `shopify.app.toml`. Handlers can
never fire because nothing subscribes them with Shopify — this silently breaks uninstall
cleanup and the order→invoice flow. **Fix depends on B3:** if we adopt Shopify-CLI-managed app
config, declare all topics (incl. `compliance_topics`) in `shopify.app.toml`; otherwise
register via Admin API on OAuth token grant. Either way the handlers (B1/B7) are prerequisites.

### B3 — Not embedded / no App Bridge (NEEDS DECISION)

No `@shopify/app-bridge` dependency; no session-token auth; no `host` handling; no CSP
`frame-ancestors https://admin.shopify.com`. Merchant auth is a standalone NextAuth login at
`/merchant-login` (`apps/web/src/lib/auth/auth-options.ts`). CLAUDE.md asserts "this is a
Shopify embedded app," but technically it is not. Shopify requires embedded apps to run in the
Admin iframe with App Bridge + session tokens. Recommendation: build the embedded experience.

### B4 — Billing via Paddle (NEEDS DECISION)

`apps/api/src/billing/*`, `env.example:62`, migration `013_paddle_migration.sql` — merchant
subscription + GMV overage charged through Paddle (Merchant of Record). Shopify generally
requires merchant-facing app charges to run through its Billing API, barring narrow exemptions
(e.g. the app is also genuinely sold as standalone SaaS off-Shopify). Recommendation: migrate
to Shopify Billing API for Store installs; verify current exemption policy before committing.

## High detail

- **B5** `shopify-provider.ts` does PKCE+state (good for standalone OAuth login) but the
  embedded install entry (Shopify GET with `shop`/`hmac`/`host`/`timestamp`) is not
  HMAC-validated and there is no App Bridge redirect. Fold into B3.
- **B6** `(merchant)` route groups are analytics/buyers/dashboard/invoices/orders/pricing/rep/
  settings — no welcome/setup/wizard. Reviewers test "merchant completes onboarding unaided."
- **B7** Only `customers/create` handled; add `customers/update` + `inventory_levels/update`
  alongside B2 registration.
- **B8** App requests `read_customers` (scopes: `read_products,write_orders,read_orders,`
  `read_customers` — `auth-options.ts:111`) and processes PII/orders → requires the Partner
  Dashboard Protected Customer Data questionnaire + approval.
- **B9** No in-repo privacy/terms routes (top-level groups are only auth/buyer/merchant/api).
  A public privacy-policy URL is mandatory for the listing.

## Already strong (pass; spot-check only)

- Shopify API resilience: `shopify-api.service.ts` — reads `X-Shopify-Shop-Api-Call-Limit`,
  backs off at 80%, honours `Retry-After`, exponential backoff on 5xx, single shared opossum
  breaker, Link-header cursor pagination, GraphQL bulk ops.
- Security: AES-256-GCM token encryption at rest (tokens decrypted only in locals, never
  logged); hardened `__Secure-` httpOnly SameSite=Strict cookies (`auth-options.ts:142`); no
  secret leakage to the client bundle (only publishable/API-base are `NEXT_PUBLIC_`).
- Webhook HMAC guard: timing-safe compare + 300s replay window + domain check
  (`webhook-hmac.guard.ts`). Idempotency via `(shopify_domain, shopify_event_id)` unique
  constraint. Fast-200 + async worker processing.
- Observability: OTel + Sentry + Pino + immutable audit log wired.

## Needs a deeper pass (audit lanes died on a usage limit)

Glass-UI accessibility/contrast (translucent surfaces are a contrast risk), financial-logic
unit-test coverage (CLAUDE.md admits near-zero), performance profiling.

## Decisions required from the owner

1. **Billing** — migrate to Shopify Billing API / keep Paddle + pursue exemption / run both.
2. **Embedding** — build App Bridge embedded experience / stay standalone.
3. **UI** — keep glass + harden a11y (recommended) / adopt Polaris / blend.
4. **Unified-buyer `customers/redact` policy** — confirm the default above (anonymize only
   when sole relationship; otherwise unlink + audit, preserving cross-merchant identity).

## Suggested sequencing

1. **Now (decision-independent):** B1 GDPR handlers → B7 extra topics → B6 onboarding →
   B9 legal pages → test coverage for financial + webhook paths.
2. **After decisions:** B3 embedding + B5 install HMAC → B2 registration (mechanism per B3) →
   B4 billing → B8 PCD submission → listing assets → clean-store E2E dry run.

## Verification pass — 2026-07-09

The decision-independent lane (B1 → B7 → B6 → B9) was built in a prior session and
adversarially re-reviewed here (per-surface reviewers + skeptic verification). Result:
the work is **correct and wired** — `pnpm typecheck` clean; compliance controller HMAC
gate / idempotency / topic dispatch, the B7 handlers, `shopify.app.toml` registration,
onboarding, and the legal pages all hold up. Three real defects were confirmed; two are
fixed, one needs an owner call.

**Fixed:**

- **PII scrub parity (medium).** `MerchantPurgeService.anonymizeBuyer` left `clerkUserId`
  populated and the GDPR worker's `anonymizeBuyer` left `passwordHash` set — each async
  scrubber missed one field the canonical `BuyersService.eraseBuyer` clears, so an
  "anonymized" buyer stayed re-identifiable. Both now match the canonical scrub.
- **Orphaned cross-merchant erasure (high).** `customers/redact` only _counted_ other
  relationships and deferred, but nothing ever removed a relationship row, so a buyer that
  ever traded with two merchants could never reach "sole relationship" and was never
  anonymized — an accepted-but-unfulfilled GDPR erasure. Now implements the **documented**
  unlink policy: delete the requesting merchant's relationship, then anonymize iff none
  remain (delete + count + scrub in one Serializable tx). Erasure now completes when the
  last merchant redacts. Covered by new specs.

**Open (needs decision — B4 billing zone):**

- **GMV overage double-charge (high).** `BillingService.chargeMonthlyGmvOverage` resets the
  `chargedAt` idempotency latch to NULL on an ambiguous Paddle failure, and
  `createOneTimeCharge` carries no idempotency key. A charge that commits at Paddle but whose
  response is lost (timeout / 5xx / breaker trip) leaves the latch released, so a manual
  re-run of that month bills the merchant twice — contradicting migration 014's stated
  guarantee. Fix is entangled with the B4 Paddle-vs-Shopify-Billing decision; see the tracked
  task.

**Test coverage added:** `compliance-webhooks.controller.spec.ts` (HMAC gate, dispatch,
idempotency, post-uninstall) and `gdpr-compliance.worker.spec.ts` (unlink→anonymize policy,
scrub completeness, idempotency) — 22 specs, green. Financial-path coverage (billing GMV,
invoices) still thin pending the B4 call.
