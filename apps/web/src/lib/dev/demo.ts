import type { MerchantRole } from '@b2b/shared/types';

/**
 * Development-only "Demo Merchant" mode.
 *
 * Lets a developer exercise the full merchant admin journey with NO Shopify
 * store and NO backend (Supabase / Redis / NestJS). A dev-only NextAuth
 * Credentials provider mints a real NextAuth session carrying these demo
 * claims; the merchant API clients (`merchantFetch`, `merchantGraphQL`) then
 * detect the demo session and serve in-app fixtures instead of calling the API.
 *
 * EVERYTHING here is gated by {@link isDemoEnabled}. In a production build
 * `process.env.NODE_ENV === 'production'`, so the gate is statically `false`,
 * the Credentials provider is never registered, the login button is never
 * rendered, and the interception branches are dead-code-eliminated. Production
 * authentication (NextAuth + Shopify OAuth) is therefore entirely unaffected.
 *
 * This module holds NO secrets and is safe to import from both client and
 * server code.
 */

/** NextAuth provider id for the dev-only demo login. */
export const DEMO_PROVIDER_ID = 'demo';

/**
 * Sentinel merchant id for the demo session. The API clients treat a session
 * whose `merchantId` equals this value as "serve mock data". A real merchant id
 * is a UUID, so this can never collide with a genuine signed-in merchant.
 */
export const DEMO_MERCHANT_ID = 'demo-merchant-0000-0000-000000000001';

/** Demo staff (owner) user id — used as the audit actor in mock responses. */
export const DEMO_MERCHANT_USER_ID = 'demo-user-0000-0000-000000000001';

/** White-label shop domain shown in the sidebar for the demo merchant. */
export const DEMO_SHOP_DOMAIN = 'demo-fashion.myshopify.com';

/** Demo merchant display / contact email. */
export const DEMO_EMAIL = 'owner@demo-fashion.myshopify.com';

/** Demo merchant role — full access so every admin action is visible. */
export const DEMO_ROLE: MerchantRole = 'owner';

/** The merchant claims the NextAuth jwt callback expects on first sign-in. */
export interface DemoMerchantClaims {
  merchantId: string;
  merchantUserId: string;
  shopifyDomain: string;
  role: MerchantRole;
  email: string;
}

export const DEMO_MERCHANT_CLAIMS: DemoMerchantClaims = {
  merchantId: DEMO_MERCHANT_ID,
  merchantUserId: DEMO_MERCHANT_USER_ID,
  shopifyDomain: DEMO_SHOP_DOMAIN,
  role: DEMO_ROLE,
  email: DEMO_EMAIL,
};

/**
 * True only outside production. `process.env.NODE_ENV` is inlined by Next at
 * build time, so this collapses to a constant `false` in production bundles and
 * lets the bundler drop every demo branch.
 */
export function isDemoEnabled(): boolean {
  return process.env.NODE_ENV !== 'production';
}

/** True when the given NextAuth session is the demo session. */
export function isDemoMerchantId(merchantId: string | null | undefined): boolean {
  return merchantId === DEMO_MERCHANT_ID;
}
