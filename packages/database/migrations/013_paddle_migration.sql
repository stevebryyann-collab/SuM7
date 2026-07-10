-- Migration 013: Stripe → Paddle rename (feat/paddle-migration)
-- Run after: 012_standing_orders.sql
-- Apply against DATABASE_DIRECT_URL (port 5432), not the pooler.
--
-- Renames the two Stripe identifier columns on merchants and the
-- 'stripe_webhook' audit-actor enum value to their Paddle equivalents. A
-- straight `prisma migrate` would DROP+recreate the enum value and the columns
-- (losing every existing subscription id, customer id, and historical audit
-- row), so this is hand-written as in-place RENAMEs that preserve all data.
--
-- RLS policies key on merchant_id only (never these columns) and the audit
-- immutability trigger is agnostic to an enum value's spelling, so neither
-- needs editing. Every statement is guarded so the migration is idempotent.

-- ── merchants.subscription_stripe_id → subscription_paddle_id ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'merchants' AND column_name = 'subscription_stripe_id'
  ) THEN
    ALTER TABLE merchants RENAME COLUMN subscription_stripe_id TO subscription_paddle_id;
  END IF;
END $$;

-- ── merchants.stripe_customer_id → paddle_customer_id ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'merchants' AND column_name = 'stripe_customer_id'
  ) THEN
    ALTER TABLE merchants RENAME COLUMN stripe_customer_id TO paddle_customer_id;
  END IF;
END $$;

-- ── AuditActorType enum value 'stripe_webhook' → 'paddle_webhook' ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'AuditActorType' AND e.enumlabel = 'stripe_webhook'
  ) THEN
    ALTER TYPE "AuditActorType" RENAME VALUE 'stripe_webhook' TO 'paddle_webhook';
  END IF;
END $$;
