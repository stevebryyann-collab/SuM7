-- Migration 014: Monthly GMV ledger + Paddle identifier uniqueness
-- Run after: 013_paddle_migration.sql
-- Apply against DATABASE_DIRECT_URL (port 5432), not the pooler.
--
-- WHY THIS EXISTS
-- merchants.gmv_current_month is a SINGLE running bucket keyed by
-- gmv_month_key. At month rollover the first payment of the new month
-- OVERWRITES it (resets the total, advances the key). The monthly overage cron
-- fires at 03:00 UTC on the 1st and bills the *previous* month — but by then any
-- payment (even a partial one) landing in the first hours of the new month has
-- already destroyed the closed month's accrued GMV, so that merchant is silently
-- NOT billed. This ledger gives every (merchant, month) its own immutable row so
-- a closed month's billable GMV can never be clobbered before it is charged.
--
-- The ledger is written ADDITIVELY (ON CONFLICT DO UPDATE SET gmv = gmv + delta)
-- at each accrual site, in the SAME transaction as the existing bucket update —
-- the running bucket is left exactly as-is for the live current-month display.
--
-- charged_at is the idempotency latch: the cron flips NULL→now() with a
-- conditional UPDATE (compare-and-set) before the Paddle charge, so a webhook
-- redelivery / job retry / second pod can never double-charge. A Paddle failure
-- resets it to NULL for a later retry.
--
-- RLS: this table is merchant-owned, so it takes the standard tenant policy
-- (merchant_id match OR app.bypass_rls). Its three writers are all covered:
--   • invoices.markAsPaid  → runs under merchantContext.run(merchantId) (tenant GUC)
--   • invoice-mark-paid.worker → SET LOCAL app.bypass_rls inside its own tx
--   • billing cron (chargeMonthlyGmvOverage) → runAsSystem (bypass)
-- Every statement is idempotent.

-- ── merchant_monthly_gmv ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS merchant_monthly_gmv (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id      UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  month_key        CHAR(7) NOT NULL,
  gmv              NUMERIC(15, 2) NOT NULL DEFAULT 0,
  charged_at       TIMESTAMPTZ,
  paddle_charge_id VARCHAR(255),
  fee_cents        INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS merchant_monthly_gmv_merchant_month_key
  ON merchant_monthly_gmv (merchant_id, month_key);

-- Row-Level Security (standard tenant policy, mirrors invoices).
ALTER TABLE merchant_monthly_gmv ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_monthly_gmv FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS merchant_monthly_gmv_tenant_isolation ON merchant_monthly_gmv;
CREATE POLICY merchant_monthly_gmv_tenant_isolation ON merchant_monthly_gmv
  USING (
    merchant_id = NULLIF(current_setting('app.current_merchant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    merchant_id = NULLIF(current_setting('app.current_merchant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

-- ── merchants: Paddle identifier uniqueness ────────────────────────────
-- Hardens webhook → merchant resolution (merchantIdForEvent) to a unique lookup.
-- Nullable columns: Postgres treats NULLs as distinct, so many un-provisioned
-- merchants may still coexist. Created CONCURRENTLY-safe as plain unique indexes.
CREATE UNIQUE INDEX IF NOT EXISTS merchants_subscription_paddle_id_key
  ON merchants (subscription_paddle_id);
CREATE UNIQUE INDEX IF NOT EXISTS merchants_paddle_customer_id_key
  ON merchants (paddle_customer_id);
