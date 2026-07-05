'use client';

import { Suspense, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { BarChart3 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { DEMO_PROVIDER_ID, isDemoEnabled } from '@/lib/dev/demo';

/**
 * Merchant login. Merchants authenticate with NextAuth + Shopify OAuth (a
 * Shopify embedded-app requirement — Clerk cannot verify Shopify session
 * tokens). The merchant enters their `*.myshopify.com` domain, which is forwarded
 * as the `shop` param so the per-shop OAuth + PKCE handshake can begin.
 */
function MerchantLoginForm(): JSX.Element {
  const searchParams = useSearchParams();
  const [shop, setShop] = useState(searchParams.get('shop') ?? '');
  const [loading, setLoading] = useState(false);
  const hasError = searchParams.get('error') !== null;

  const start = (event: React.FormEvent): void => {
    event.preventDefault();
    const domain = shop.trim().toLowerCase();
    if (domain.length === 0) return;
    setLoading(true);
    // Forward the shop domain so the Shopify provider can resolve per-shop URLs.
    void signIn('shopify', { callbackUrl: '/dashboard' }, { shop: domain });
  };

  return (
    <div className="panel p-8">
      <div className="mb-6 flex items-center gap-2">
        <BarChart3 className="h-6 w-6 text-accent" />
        <span className="text-base font-semibold text-text-primary">Wholesale Admin</span>
      </div>
      <form onSubmit={start} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="shop">Shopify store domain</Label>
          <Input
            id="shop"
            placeholder="your-store.myshopify.com"
            value={shop}
            onChange={(e) => setShop(e.target.value)}
            autoComplete="off"
          />
        </div>
        {hasError ? (
          <p className="text-sm text-red-700">Sign-in failed. Please try connecting your store again.</p>
        ) : null}
        <Button type="submit" variant="primary" className="w-full" disabled={loading || shop.trim().length === 0}>
          {loading ? <Spinner /> : null}
          Connect with Shopify
        </Button>
      </form>
      <p className="mt-4 text-center text-xs text-text-tertiary">
        Buyers should use the storefront wholesale portal, not this admin login.
      </p>
      {isDemoEnabled() ? <DemoLoginSection /> : null}
    </div>
  );
}

/**
 * DEV ONLY: one-click login as a demo merchant with seeded sample data — no
 * Shopify store and no backend required. Rendered only outside production (the
 * `demo` NextAuth provider is likewise registered only in development), so this
 * block never appears in a production build.
 */
function DemoLoginSection(): JSX.Element {
  const [loading, setLoading] = useState(false);

  const startDemo = (): void => {
    setLoading(true);
    void signIn(DEMO_PROVIDER_ID, { callbackUrl: '/dashboard' });
  };

  return (
    <div className="mt-6 border-t border-dashed border-border-strong pt-5">
      <p className="mb-2 text-label uppercase tracking-wider text-text-secondary">Development</p>
      <Button
        type="button"
        variant="default"
        className="w-full"
        disabled={loading}
        onClick={startDemo}
      >
        {loading ? <Spinner /> : null}
        Demo Merchant Login
      </Button>
      <p className="mt-2 text-center text-xs text-text-tertiary">
        Loads sample data without Shopify. Local development only.
      </p>
    </div>
  );
}

export default function MerchantLoginPage(): JSX.Element {
  return (
    <Suspense fallback={<div className="panel p-8 text-sm text-text-secondary">Loading…</div>}>
      <MerchantLoginForm />
    </Suspense>
  );
}
