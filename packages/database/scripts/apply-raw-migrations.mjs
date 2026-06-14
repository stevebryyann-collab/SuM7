/**
 * Applies the hand-written raw SQL migrations (extensions, audit immutability,
 * RLS) that cannot be expressed in Prisma Schema Language. Run AFTER
 * `prisma migrate deploy`. Each file is wrapped in a transaction; statements
 * are idempotent so re-running is safe.
 *
 * Usage: node scripts/apply-raw-migrations.mjs
 * Requires: DATABASE_DIRECT_URL (a superuser/owner connection — RLS + roles +
 * extensions need elevated privileges and must bypass PgBouncer).
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

const FILES = [
  '001_extensions.sql',
  '002_audit_log_immutability.sql',
  '003_rls.sql',
];

async function main() {
  const connectionString = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_DIRECT_URL (or DATABASE_URL) must be set');
  }

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    for (const file of FILES) {
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      process.stdout.write(`Applying ${file}... `);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('COMMIT');
        process.stdout.write('ok\n');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('\nRaw migration failed:', error.message);
  process.exitCode = 1;
});
