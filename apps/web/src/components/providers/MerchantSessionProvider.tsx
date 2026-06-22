'use client';

import type { ReactNode } from 'react';
import { SessionProvider } from 'next-auth/react';

/**
 * Merchant-only NextAuth session provider. Wraps the merchant route group so
 * `useSession()` / {@link merchantFetch} can read the NextAuth JWT. Buyers never
 * see this provider — their identity lives in Clerk.
 */
export function MerchantSessionProvider({ children }: { children: ReactNode }): JSX.Element {
  return <SessionProvider refetchOnWindowFocus={false}>{children}</SessionProvider>;
}
