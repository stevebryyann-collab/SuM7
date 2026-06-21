-- 006_merchant_settings.sql
--
-- Stage 4 (Dashboard, Analytics & Settings) additive columns. Mirrors the
-- Prisma schema changes so a real database stays in sync with the generated
-- client. All statements use IF NOT EXISTS so the migration is idempotent and
-- safe to re-run. Apply with the DIRECT (port 5432) connection after the Prisma
-- baseline, e.g. via the Supabase SQL editor or `migrate:raw`.
--
--   merchants.invoice_prefix          — invoice-number prefix (future invoices only)
--   merchants.payment_instructions    — rendered on every invoice
--   merchants.notify_*                — owner email notification preferences
--   merchant_users.last_login_at      — surfaced on the Team settings page

ALTER TABLE "merchants"
  ADD COLUMN IF NOT EXISTS "invoice_prefix" VARCHAR(8) NOT NULL DEFAULT 'INV',
  ADD COLUMN IF NOT EXISTS "payment_instructions" TEXT,
  ADD COLUMN IF NOT EXISTS "notify_new_application" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "notify_invoice_overdue" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "notify_payment_received" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "merchant_users"
  ADD COLUMN IF NOT EXISTS "last_login_at" TIMESTAMPTZ(6);
