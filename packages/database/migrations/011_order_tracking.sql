-- Migration 011: Order fulfillment tracking (Part 3 of 4)
-- Run after: 010_sales_rep_features.sql
-- Adds carrier tracking + shipment timestamps to orders, populated by the
-- Shopify fulfillments/{create,update} webhook workers. All idempotent.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(100);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_url TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment_service VARCHAR(100);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS estimated_delivery_at TIMESTAMPTZ;
