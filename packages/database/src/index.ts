/**
 * Database package entrypoint. Re-exports the generated Prisma client plus a
 * lazily-instantiated singleton, so both apps share one client type surface.
 */
export * from '@prisma/client';
export { PrismaClient, Prisma } from '@prisma/client';

import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __b2bPrisma: PrismaClient | undefined;
}

/**
 * Process-wide Prisma singleton for scripts and serverless contexts. The NestJS
 * app does NOT use this — it has its own DI-managed PrismaService with RLS
 * middleware. This export exists for seeds, one-off scripts, and the web app.
 */
export const prisma: PrismaClient =
  globalThis.__b2bPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__b2bPrisma = prisma;
}
