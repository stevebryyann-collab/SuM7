---
name: create-migration
description: Scaffold a database change for this repo the correct way — Prisma model/field edits plus the matching Row-Level Security SQL policy. Use when adding or changing a table/column in packages/database. Invoke with /create-migration.
disable-model-invocation: true
---

# create-migration

This project uses Supabase Postgres with Prisma 5 **and** hand-written RLS policies.
A schema change is not done until both halves exist. This skill walks that flow so a
new table never ships without tenant isolation.

## Ground rules (from CLAUDE.md)

- Datasource always has both `url` (pooler, runtime) and `directUrl` (direct,
  migrations). Never remove either.
- Multi-tenancy is TWO layers: application `where: { merchantId }` **and** Postgres
  RLS. Both always active.
- Migrations run against `DATABASE_DIRECT_URL` (port 5432), never the pooler.

## Steps

1. **Edit the Prisma schema.** `packages/database/prisma/schema.prisma`. Add the
   model or column. Follow existing conventions: `@map`/`@@map` to snake_case DB
   names, `@id` cuid/uuid, `createdAt`/`updatedAt`, and a `merchantId` column on any
   tenant-owned table.

2. **Decide the RLS posture — this is the key decision:**
   - **Default: RLS ON.** Any table read/written inside a merchant request context
     gets a policy scoping rows to the current tenant. Model it on the existing
     policies in `packages/database/migrations/003_rls.sql`.
   - **RLS OFF (rare, deliberate):** only for tables read by buyer-portal handlers
     that run WITHOUT a tenant context — currently `shopping_lists`,
     `shopping_list_items`, `b2b_discount_codes`, `standing_orders`. RLS would fail
     those reads closed, so isolation is enforced in the app layer via
     `where: { buyerId, merchantId }`. If you pick this, you MUST add the equivalent
     app-layer filter and note the reasoning in a comment, matching how migrations
     010/012 document it.

3. **Generate the Prisma migration SQL:**
   ```
   cd /root/wholesale-portal
   pnpm --filter @b2b/database exec prisma migrate dev --name <change_name>
   ```
   (Uses `DATABASE_DIRECT_URL`. If offline, hand-author the SQL under
   `packages/database/migrations/` following the numbered convention.)

4. **Write the RLS SQL** (if RLS ON) as a new numbered file in
   `packages/database/migrations/` — `ENABLE ROW LEVEL SECURITY`, then `CREATE POLICY`
   USING/WITH CHECK on the tenant column, granted to `app_user`. Keep audit tables
   writable only by `audit_writer`. This raw SQL is applied via `pnpm db:migrate:raw`
   and pasted into the Supabase SQL editor per the local-dev steps in CLAUDE.md.

5. **Regenerate the client and verify:**
   ```
   pnpm db:generate
   pnpm typecheck
   ```
   Zero errors required.

6. **Update CLAUDE.md** — append the new table/column to the "New database tables /
   columns added since the schema" list, noting the migration number and RLS posture,
   so the next session sees it.

## Checklist before calling it done
- [ ] Prisma schema updated with snake_case `@map`s and `merchantId` (if tenant-owned)
- [ ] Migration SQL generated/written under `packages/database/migrations/`
- [ ] RLS policy added (or RLS-OFF justified + app-layer filter confirmed)
- [ ] `pnpm db:generate && pnpm typecheck` pass clean
- [ ] CLAUDE.md schema list updated
