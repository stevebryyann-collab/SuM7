import type { ReactNode } from 'react';

/**
 * Auth route-group layout. Provides ONLY the shared centered chrome for every
 * auth page. It is deliberately identity-agnostic: merchant auth (NextAuth +
 * Shopify OAuth) and buyer auth (Clerk) must never share a provider tree. The
 * Clerk provider is scoped to the nested `(buyer-auth)` group so the
 * NextAuth-based `/merchant-login` page never mounts Clerk (which would throw
 * `Missing publishableKey` when the buyer key is absent).
 */
export default function AuthLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
