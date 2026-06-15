-- 004_drop_merchant_clerk_org_id.sql
--
-- Reverts the all-Clerk merchant-auth migration back to NextAuth + Shopify OAuth
-- (per CLAUDE.md, which is the single source of truth and mandates NextAuth for
-- merchants). Merchants are identified by `shopify_domain`; the Clerk
-- organization id is no longer used for merchant resolution.
--
-- Apply with the DIRECT (port 5432) connection, after the Prisma baseline
-- migration, e.g. `pnpm --filter @b2b/database migrate:raw`.

ALTER TABLE merchants DROP COLUMN IF EXISTS clerk_org_id;
