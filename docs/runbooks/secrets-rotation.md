# Runbook — Secrets Rotation

**Audience:** on-call / platform engineer. **Cadence:** quarterly, plus immediately on any
suspected compromise. **Goal:** rotate a secret with zero downtime and no dropped financial writes.

---

## Principles

- **Rotate, don't break.** Where a provider supports two active credentials, add the new one,
  deploy, verify, then revoke the old one. Never delete-then-create.
- **Encryption keys are versioned.** The app encrypts PII with `ENCRYPTION_KEY_V{n}` and records
  `CURRENT_ENCRYPTION_KEY_VERSION`. Rotation adds a new version; old data stays readable under its
  stored `*KeyVersion` column. Never reuse or delete an old version while rows reference it.
- **One secret at a time.** Rotate, verify green, then move on. Batched rotations make rollback ambiguous.

## Inventory (where secrets live)

| Secret                                       | Used by                  | Store                            |
| -------------------------------------------- | ------------------------ | -------------------------------- |
| `DATABASE_URL` / `DATABASE_DIRECT_URL`       | API                      | Railway env, Supabase            |
| `NEXTAUTH_SECRET`                            | web + API (merchant JWT) | Vercel + Railway (must match)    |
| `CLERK_SECRET_KEY` / `CLERK_WEBHOOK_SECRET`  | API                      | Railway, Clerk dashboard         |
| `SHOPIFY_CLIENT_SECRET`                      | web + API                | Vercel/Railway, Shopify Partners |
| `PADDLE_API_KEY` / `PADDLE_WEBHOOK_SECRET`   | API                      | Railway, Paddle dashboard        |
| `RESOLVE_API_KEY` / `RESOLVE_WEBHOOK_SECRET` | API                      | Railway, Resolve dashboard       |
| `AWS_*` / `S3_KMS_KEY_ARN`                   | API                      | Railway, AWS IAM/KMS             |
| `RESEND_API_KEY`                             | API                      | Railway, Resend                  |
| `INTERNAL_API_SECRET`                        | web → API internal calls | Vercel + Railway (must match)    |
| `ENCRYPTION_KEY_V{n}`                        | API (PII at rest)        | Railway only                     |

## General procedure

1. **Announce** a rotation window in the ops channel; note the secret and blast radius.
2. **Generate** the new value (provider console, or `openssl rand -base64 32`).
3. **Add** it as the new env value in the relevant platform(s). For paired secrets
   (`NEXTAUTH_SECRET`, `INTERNAL_API_SECRET`) update **web and API together**.
4. **Deploy** API first (Railway), then web (Vercel). Watch Sentry + health checks.
5. **Verify** (see per-secret checks below).
6. **Revoke** the old credential at the provider once traffic is confirmed healthy.
7. **Record** the rotation (date, operator, secret) in the secrets log.

## Per-secret notes

### `NEXTAUTH_SECRET` (merchant sessions)

Rotating invalidates all existing merchant JWTs — merchants must re-authenticate. Web and API
**must** share the identical value (the API's `MerchantSessionGuard` verifies the HS256 token).
Rotate during low-traffic hours; expect a sign-in spike. Verify: sign in as a merchant, load
`/dashboard`, confirm an authenticated API call (e.g. `GET /invoices`) returns 200.

### `INTERNAL_API_SECRET`

Guards `POST /internal/merchants/upsert` (the NextAuth `signIn` callback sends `X-Internal-Secret`).
Min 32 chars. Web + API must match. Verify: a fresh merchant OAuth sign-in completes (upsert succeeds).

### `*_WEBHOOK_SECRET` (Clerk / Paddle / Resolve)

1. Add the new signing secret in the provider dashboard (providers allow multiple).
2. Deploy the API with the new secret.
3. Send a test event; confirm the controller verifies the signature (200, not 401).
4. Remove the old signing secret in the dashboard.
   Webhook routes verify the signature **before** any processing — a bad secret returns 401 and the
   event is retried by the provider, so there is no data loss during the overlap.

### `CLERK_SECRET_KEY` / `PADDLE_API_KEY` / `RESOLVE_API_KEY` / `RESEND_API_KEY`

API-key style. Create a new key, deploy, verify a live call through the circuit breaker succeeds,
then revoke the old key. External calls are breaker-wrapped, so a misconfig trips the breaker
rather than cascading.

### `ENCRYPTION_KEY_V{n}` (PII at rest)

1. Add `ENCRYPTION_KEY_V{n+1}` **without** removing prior versions.
2. Set `CURRENT_ENCRYPTION_KEY_VERSION={n+1}`. New writes use it; reads pick the version from each
   row's `*KeyVersion` column.
3. (Optional) Run a background re-encryption job to migrate old rows forward.
4. Only after every row references ≥ a version may an old key be retired.
   Never set `CURRENT_ENCRYPTION_KEY_VERSION` to a version whose key is not present in env.

### Database credentials

Rotate the Supabase DB password; update `DATABASE_URL` (pooler, :6543) **and**
`DATABASE_DIRECT_URL` (direct, :5432) together. Deploy API. Verify a read and a health check.
Migrations use the direct URL; runtime uses the pooler.

## Rollback

If verification fails: restore the previous env value, redeploy (API then web), and confirm health
before investigating. For webhook/API-key secrets the old credential is still valid until explicitly
revoked, so rollback is immediate. For `ENCRYPTION_KEY_*`, never roll `CURRENT_ENCRYPTION_KEY_VERSION`
back below a version that new rows already used.
