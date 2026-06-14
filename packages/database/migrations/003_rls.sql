-- 003_rls.sql
-- Row-Level Security: the SECOND isolation layer (the first is the
-- application's `where: { merchantId }`). Both are mandatory — defense in depth.
--
-- Runtime contract (set by PrismaService per request / per transaction):
--   SET app.current_merchant_id = '<uuid>'   -- the tenant in scope
--   SET app.bypass_rls          = 'true'     -- ONLY for trusted system paths
--
-- bypass_rls = 'true' is granted to: BullMQ workers processing webhooks,
-- scheduled cron jobs (GMV rollups, invoice overdue sweeps, token GC),
-- internal health checks, and the cross-merchant buyer-auth lookups. Every
-- such path is funnelled through MerchantContextService.runAsSystem().
--
-- All policies read the GUC safely: an unset/empty value yields NULL, which
-- matches no row (so a missing context fails closed rather than open).

-- ── Roles (idempotent) ─────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'audit_writer') THEN
    CREATE ROLE audit_writer NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'internal_service') THEN
    CREATE ROLE internal_service NOLOGIN;
  END IF;
END;
$$;

-- The login role used by the app (b2bapp locally) inherits app_user so RLS is
-- enforced, and is also granted the privileged roles it elevates into via the
-- bypass_rls GUC. It must NOT be BYPASSRLS at the role level.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'b2bapp') THEN
    EXECUTE 'GRANT app_user, audit_writer, internal_service TO b2bapp';
    EXECUTE 'ALTER ROLE b2bapp NOBYPASSRLS';
  END IF;
END;
$$;

-- ── Helper expressions ─────────────────────────────────────────────────
-- Inlined in every policy:
--   tenant match : (<merchant_col> = NULLIF(current_setting('app.current_merchant_id', true), '')::uuid)
--   bypass       : (current_setting('app.bypass_rls', true) = 'true')

-- ── merchants ──────────────────────────────────────────────────────────
ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS merchants_tenant_isolation ON merchants;
CREATE POLICY merchants_tenant_isolation ON merchants
  USING (
    id = NULLIF(current_setting('app.current_merchant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    id = NULLIF(current_setting('app.current_merchant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

-- ── merchant_users ─────────────────────────────────────────────────────
ALTER TABLE merchant_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS merchant_users_tenant_isolation ON merchant_users;
CREATE POLICY merchant_users_tenant_isolation ON merchant_users
  USING (
    merchant_id = NULLIF(current_setting('app.current_merchant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    merchant_id = NULLIF(current_setting('app.current_merchant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

-- ── merchant_buyer_relationships ───────────────────────────────────────
ALTER TABLE merchant_buyer_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_buyer_relationships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mbr_tenant_isolation ON merchant_buyer_relationships;
CREATE POLICY mbr_tenant_isolation ON merchant_buyer_relationships
  USING (
    merchant_id = NULLIF(current_setting('app.current_merchant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    merchant_id = NULLIF(current_setting('app.current_merchant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

-- ── pricing_tiers ──────────────────────────────────────────────────────
ALTER TABLE pricing_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_tiers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pricing_tiers_tenant_isolation ON pricing_tiers;
CREATE POLICY pricing_tiers_tenant_isolation ON pricing_tiers
  USING (
    merchant_id = NULLIF(current_setting('app.current_merchant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    merchant_id = NULLIF(current_setting('app.current_merchant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

-- ── pricing_tier_overrides (no merchant_id → EXISTS via pricing_tiers) ──
ALTER TABLE pricing_tier_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_tier_overrides FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pto_tenant_isolation ON pricing_tier_overrides;
CREATE POLICY pto_tenant_isolation ON pricing_tier_overrides
  USING (
    current_setting('app.bypass_rls', true) = 'true'
    OR EXISTS (
      SELECT 1 FROM pricing_tiers pt
      WHERE pt.id = pricing_tier_overrides.pricing_tier_id
        AND pt.merchant_id = NULLIF(current_setting('app.current_merchant_id', true), '')::uuid
    )
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'true'
    OR EXISTS (
      SELECT 1 FROM pricing_tiers pt
      WHERE pt.id = pricing_tier_overrides.pricing_tier_id
        AND pt.merchant_id = NULLIF(current_setting('app.current_merchant_id', true), '')::uuid
    )
  );

-- ── orders ─────────────────────────────────────────────────────────────
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS orders_tenant_isolation ON orders;
CREATE POLICY orders_tenant_isolation ON orders
  USING (
    merchant_id = NULLIF(current_setting('app.current_merchant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    merchant_id = NULLIF(current_setting('app.current_merchant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

-- ── order_line_items (no merchant_id → EXISTS via orders) ──────────────
ALTER TABLE order_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_line_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS oli_tenant_isolation ON order_line_items;
CREATE POLICY oli_tenant_isolation ON order_line_items
  USING (
    current_setting('app.bypass_rls', true) = 'true'
    OR EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_line_items.order_id
        AND o.merchant_id = NULLIF(current_setting('app.current_merchant_id', true), '')::uuid
    )
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'true'
    OR EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_line_items.order_id
        AND o.merchant_id = NULLIF(current_setting('app.current_merchant_id', true), '')::uuid
    )
  );

-- ── invoices ───────────────────────────────────────────────────────────
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoices_tenant_isolation ON invoices;
CREATE POLICY invoices_tenant_isolation ON invoices
  USING (
    merchant_id = NULLIF(current_setting('app.current_merchant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    merchant_id = NULLIF(current_setting('app.current_merchant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

-- ── buyer_registration_applications ────────────────────────────────────
ALTER TABLE buyer_registration_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE buyer_registration_applications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bra_tenant_isolation ON buyer_registration_applications;
CREATE POLICY bra_tenant_isolation ON buyer_registration_applications
  USING (
    merchant_id = NULLIF(current_setting('app.current_merchant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    merchant_id = NULLIF(current_setting('app.current_merchant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

-- ── webhook_events (keyed by shopify_domain → map to tenant) ───────────
-- Written/processed by system workers (bypass). Merchants may read their own.
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS webhook_events_isolation ON webhook_events;
CREATE POLICY webhook_events_isolation ON webhook_events
  USING (
    current_setting('app.bypass_rls', true) = 'true'
    OR EXISTS (
      SELECT 1 FROM merchants m
      WHERE m.shopify_domain = webhook_events.shopify_domain
        AND m.id = NULLIF(current_setting('app.current_merchant_id', true), '')::uuid
    )
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'true'
  );

-- ── audit_log (read tenant-scoped; insert via audit_writer; never u/d) ──
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_log_tenant_read ON audit_log;
CREATE POLICY audit_log_tenant_read ON audit_log
  FOR SELECT
  USING (
    merchant_id = NULLIF(current_setting('app.current_merchant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

DROP POLICY IF EXISTS audit_log_insert ON audit_log;
CREATE POLICY audit_log_insert ON audit_log
  FOR INSERT
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'true'
    OR merchant_id = NULLIF(current_setting('app.current_merchant_id', true), '')::uuid
    OR merchant_id IS NULL
  );

-- Table-level privilege hardening for the audit trail.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'audit_writer') THEN
    EXECUTE 'GRANT INSERT, SELECT ON audit_log TO audit_writer';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE 'GRANT SELECT ON audit_log TO app_user';
    EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM app_user';
  END IF;
END;
$$;

-- idempotency_keys is intentionally NOT under RLS: it stores no tenant data
-- (opaque per-request keys + hashed payloads) and ownership is enforced by the
-- idempotency middleware. Leaving it RLS-free avoids breaking the request path,
-- which may run with a tenant context but never a bypass.
