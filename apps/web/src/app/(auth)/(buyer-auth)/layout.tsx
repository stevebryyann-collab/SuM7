import type { ReactNode } from 'react';
import { ClerkProvider } from '@clerk/nextjs';
import { CLERK_PUBLISHABLE_KEY } from '@/lib/env';

/**
 * Buyer-auth route-group layout. Scopes Clerk to the buyer sign-in/sign-up pages
 * ONLY. The sibling `/merchant-login` page lives in the parent `(auth)` group and
 * is intentionally outside this provider — merchants authenticate with NextAuth +
 * Shopify OAuth and must never mount Clerk (hard architectural rule, and mounting
 * Clerk without a publishable key throws `Missing publishableKey`).
 *
 * Route groups in parentheses do not affect the URL, so `/buyer-login` and
 * `/buyer-signup` are unchanged.
 */
export default function BuyerAuthLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} signInUrl="/buyer-login" signUpUrl="/buyer-signup">
      {children}
    </ClerkProvider>
  );
}
