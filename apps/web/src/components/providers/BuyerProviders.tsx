'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { ClerkProvider } from '@clerk/nextjs';
import { CLERK_PUBLISHABLE_KEY } from '@/lib/env';
import { ClerkTokenBridge } from './ClerkTokenBridge';

/**
 * The buyer's resolved merchant tenant, read from the `__merchant_id` App-Proxy
 * cookie by the buyer layout. Used only to satisfy request validation
 * (`BulkOrderSchema.merchantId`); the API treats the cookie/session as the
 * authoritative tenant, never this value.
 */
const BuyerMerchantContext = createContext<string | null>(null);

/** Access the buyer's merchant id (null when not resolvable from the cookie). */
export function useBuyerMerchantId(): string | null {
  return useContext(BuyerMerchantContext);
}

/**
 * Buyer portal providers: Clerk (buyer identity — NEVER NextAuth), the token
 * bridge that wires Clerk's getToken into {@link buyerFetch}, and the merchant
 * tenant context. The TanStack Query client comes from the root layout.
 */
export function BuyerProviders({
  merchantId,
  children,
}: {
  merchantId: string | null;
  children: ReactNode;
}): JSX.Element {
  return (
    <ClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY}
      signInUrl="/buyer-login"
      signUpUrl="/buyer-signup"
    >
      <ClerkTokenBridge />
      <BuyerMerchantContext.Provider value={merchantId}>{children}</BuyerMerchantContext.Provider>
    </ClerkProvider>
  );
}
