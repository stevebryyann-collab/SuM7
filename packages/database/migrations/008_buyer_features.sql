-- Migration 008: Buyer features — shopping lists, discount codes, inventory, back-orders
-- Run after: 007_*.sql
-- Adds: shopping_lists, shopping_list_items, b2b_discount_codes tables
-- Extends: orders table with discount and back-order columns

-- Shopping lists (buyer-scoped, per-merchant)
CREATE TABLE shopping_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id UUID NOT NULL REFERENCES buyers(id) ON DELETE CASCADE,
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_shopping_lists_buyer_merchant ON shopping_lists(buyer_id, merchant_id);
CREATE UNIQUE INDEX idx_shopping_lists_name_unique ON shopping_lists(buyer_id, merchant_id, name);

-- Shopping list items (variant references, denormalized product data for stability)
CREATE TABLE shopping_list_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  shopify_variant_id VARCHAR(100) NOT NULL,
  shopify_product_id VARCHAR(100) NOT NULL,
  product_title VARCHAR(255) NOT NULL,
  variant_title VARCHAR(255),
  sku VARCHAR(100),
  quantity INT NOT NULL CHECK (quantity >= 1 AND quantity <= 9999),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_shopping_list_items_list ON shopping_list_items(list_id);
CREATE UNIQUE INDEX idx_shopping_list_items_unique ON shopping_list_items(list_id, shopify_variant_id);

-- B2B discount codes (merchant-scoped, usage tracked)
CREATE TABLE b2b_discount_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  code VARCHAR(50) NOT NULL,
  description VARCHAR(255),
  discount_type VARCHAR(20) NOT NULL CHECK (discount_type IN ('pct_off', 'fixed_amount')),
  discount_value DECIMAL(15,2) NOT NULL CHECK (discount_value > 0),
  min_order_amount DECIMAL(15,2),
  max_uses INT,
  used_count INT NOT NULL DEFAULT 0,
  valid_from TIMESTAMPTZ,
  valid_to TIMESTAMPTZ,
  applies_to VARCHAR(50) DEFAULT 'all',
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES merchant_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_b2b_discount_codes_unique ON b2b_discount_codes(merchant_id, UPPER(code));
CREATE INDEX idx_b2b_discount_codes_active ON b2b_discount_codes(merchant_id, is_active);

-- Extend orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_code_id UUID REFERENCES b2b_discount_codes(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(15,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS contains_back_order BOOLEAN DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sales_rep_id UUID REFERENCES merchant_users(id);
