-- Migration 012: Standing orders — reorder reminders (Part 3 of 4)
-- Run after: 011_order_tracking.sql
--
-- RLS: standing_orders is BUYER-scoped and accessed by buyer-portal routes
-- (ClerkBuyerGuard), whose request handler runs WITHOUT a merchant tenant
-- context — exactly like the Part 2 shopping_lists table. Enabling RLS would
-- fail those reads closed, so isolation is enforced at the application layer
-- (where: { buyerId, merchantId }) and by the SYSTEM-context daily cron (which
-- bypasses RLS to sweep across all merchants). All statements are idempotent.

CREATE TABLE IF NOT EXISTS standing_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id UUID NOT NULL REFERENCES buyers(id) ON DELETE CASCADE,
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  source_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  name VARCHAR(100) NOT NULL DEFAULT 'Regular Order',
  reminder_frequency_days INT NOT NULL DEFAULT 7 CHECK (reminder_frequency_days IN (7, 14, 30)),
  last_reminder_at TIMESTAMPTZ,
  next_reminder_at TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_standing_orders_next ON standing_orders(next_reminder_at) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_standing_orders_buyer ON standing_orders(buyer_id, merchant_id);
