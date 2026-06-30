-- Migration 010: Sales-rep portal (Part 3 of 4)
-- Run after: 009_merchant_analytics.sql
-- Adds: the 'sales_rep' merchant-user role, the sales_rep_sessions table, and
-- the orders.rep_session_id attribution column.
--
-- RLS: sales_rep_sessions is MERCHANT-scoped. It is read/written only by
-- merchant-session routes (which carry a tenant context via the
-- TenantContextInterceptor) and by the session-validation guard lookup (which
-- runs as the SYSTEM and bypasses RLS). Buyer-portal routes never touch it, so
-- enabling RLS here is safe — unlike the buyer-scoped Part 2 tables
-- (shopping_lists), which are intentionally RLS-free because buyer handlers run
-- without a tenant context. All statements are idempotent.

-- New merchant-user role. ALTER TYPE ... ADD VALUE is transaction-safe in PG12+
-- provided the new value is not used as a literal in the same transaction (it is
-- not here — the migration only references the type, never the 'sales_rep' value).
ALTER TYPE "MerchantUserRole" ADD VALUE IF NOT EXISTS 'sales_rep';

-- Impersonation sessions: a rep places orders on behalf of an approved buyer.
CREATE TABLE IF NOT EXISTS sales_rep_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_id UUID NOT NULL REFERENCES merchant_users(id) ON DELETE CASCADE,
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  buyer_id UUID NOT NULL REFERENCES buyers(id) ON DELETE CASCADE,
  session_token VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rep_sessions_token ON sales_rep_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_rep_sessions_rep ON sales_rep_sessions(rep_id, merchant_id);

-- Attribution: the impersonation session an order was placed under (nullable).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rep_session_id UUID REFERENCES sales_rep_sessions(id);

-- ── RLS (mirrors the tenant-isolation policies in 003_rls.sql) ──────────
ALTER TABLE sales_rep_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_rep_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_rep_sessions_tenant_isolation ON sales_rep_sessions;
CREATE POLICY sales_rep_sessions_tenant_isolation ON sales_rep_sessions
  USING (
    merchant_id = NULLIF(current_setting('app.current_merchant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    merchant_id = NULLIF(current_setting('app.current_merchant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );
