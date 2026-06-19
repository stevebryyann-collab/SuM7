/**
 * Public runtime configuration for the browser bundle. Only NEXT_PUBLIC_*
 * variables are safe here — anything secret lives server-side only (NextAuth
 * route handlers, server components).
 *
 * These are read at module load. We intentionally do NOT throw on missing values
 * at import time: `next build` evaluates modules without production secrets in
 * CI, and a thrown error there would fail an otherwise-valid build. Instead we
 * warn in development and let the dependent client (Clerk, fetch) fail visibly
 * at runtime if a deploy is genuinely misconfigured.
 */

function publicEnv(name: string, value: string | undefined): string {
  if ((!value || value.trim().length === 0) && process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.warn(`[env] ${name} is not set; dependent features will not work until configured.`);
  }
  return value ?? '';
}

/**
 * Base URL of the NestJS API (Railway). The buyer portal and merchant admin
 * both talk to the same API; tenancy is resolved server-side from the token.
 */
export const API_BASE_URL = publicEnv('NEXT_PUBLIC_API_BASE_URL', process.env.NEXT_PUBLIC_API_BASE_URL);

/** GraphQL gateway path on the API (merchant dashboard only). */
export const GRAPHQL_ENDPOINT = `${API_BASE_URL.replace(/\/$/, '')}/graphql`;

/** Clerk publishable key — used to mount the buyer auth components. */
export const CLERK_PUBLISHABLE_KEY = publicEnv(
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
);
