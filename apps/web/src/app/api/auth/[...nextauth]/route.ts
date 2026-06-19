import NextAuth from 'next-auth';
import type { NextRequest } from 'next/server';
import { buildAuthOptions } from '@/lib/auth/auth-options';

/**
 * Merchant NextAuth route handler (App Router). Buyers DO NOT use this endpoint —
 * buyer auth is owned entirely by Clerk. The handler drives the Shopify OAuth +
 * PKCE flow and issues the HS256 API token consumed by the NestJS
 * merchant-session guard.
 *
 * Options are built per-request via {@link buildAuthOptions} so the required
 * server secrets (NEXTAUTH_SECRET, Shopify credentials) are read at request time
 * rather than at module-load — otherwise `next build`'s page-data collection,
 * which runs without production secrets, would throw.
 */
async function handler(req: NextRequest, ctx: { params: { nextauth: string[] } }): Promise<Response> {
  return NextAuth(req as never, ctx as never, buildAuthOptions());
}

export { handler as GET, handler as POST };
