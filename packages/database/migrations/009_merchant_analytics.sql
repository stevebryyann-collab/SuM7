-- Migration 009: Merchant analytics and inventory settings
-- Run after: 008_buyer_features.sql
-- Adds: GTM/GA4 configuration and back-order settings to merchants table

ALTER TABLE merchants ADD COLUMN IF NOT EXISTS gtm_id VARCHAR(50);
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS ga4_id VARCHAR(50);
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS allows_back_orders BOOLEAN DEFAULT false;
