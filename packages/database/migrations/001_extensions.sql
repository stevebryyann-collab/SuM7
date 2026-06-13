-- 001_extensions.sql
-- Postgres extensions, the invoice number sequence, and the indexes that
-- cannot be expressed in Prisma Schema Language (GIN trigram + NULLS NOT
-- DISTINCT functional unique index).
--
-- Apply AFTER `prisma migrate deploy` has created the base tables, OR fold the
-- statements into the first Prisma migration. Every statement is idempotent.

-- ── Extensions ─────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- ── Invoice number sequence ────────────────────────────────────────────
-- Monotonic, gap-tolerant source for human-facing invoice numbers. The
-- application formats e.g. INV-000001 from nextval('invoice_number_seq').
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq
  AS BIGINT
  START WITH 1
  INCREMENT BY 1
  MINVALUE 1
  NO MAXVALUE
  CACHE 1;

-- ── Trigram index for buyer company-name fuzzy search ──────────────────
CREATE INDEX IF NOT EXISTS buyers_company_name_trgm_idx
  ON buyers
  USING GIN (company_name gin_trgm_ops);

-- ── Pricing override uniqueness treating NULL variant as a real value ───
-- A tier may carry a product-level override (variant NULL) AND variant-level
-- overrides; COALESCE collapses NULL to '' so the product-level row is unique.
CREATE UNIQUE INDEX IF NOT EXISTS pricing_tier_overrides_unique
  ON pricing_tier_overrides (
    pricing_tier_id,
    shopify_product_id,
    COALESCE(shopify_variant_id, '')
  );
