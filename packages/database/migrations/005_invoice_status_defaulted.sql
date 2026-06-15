-- 005_invoice_status_defaulted.sql
--
-- Adds the `defaulted` value to the InvoiceStatus enum. Set on an invoice when
-- the BNPL provider (Resolve) reports PAYMENT_DEFAULTED for a financed order —
-- see apps/api/src/bnpl/adapters/resolve.adapter.ts (handleWebhook).
--
-- ADD VALUE is transactional in PostgreSQL 12+, but the new label cannot be
-- used in the SAME transaction that adds it; `IF NOT EXISTS` makes this
-- migration idempotent. Apply with the DIRECT (port 5432) connection, after the
-- Prisma baseline migration, e.g. `pnpm --filter @b2b/database migrate:raw`.

ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'defaulted';
