import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { BuyerProviders } from '@/components/providers/BuyerProviders';
import { BuyerNav } from '@/components/buyer/BuyerNav';

/**
 * Buyer portal route-group layout. Resolves the merchant tenant from the
 * `__merchant_id` cookie (set by the App-Proxy edge middleware) and wraps the
 * subtree in Clerk + the buyer token bridge. White-labeled: the buyer only ever
 * sees the merchant's storefront context, never the platform brand.
 */
export default function BuyerLayout({ children }: { children: ReactNode }): JSX.Element {
  const merchantId = cookies().get('__merchant_id')?.value ?? null;

  return (
    <BuyerProviders merchantId={merchantId}>
      <div className="flex min-h-screen flex-col bg-background">
        <header className="border-b border-gray-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
            <Link href="/portal/catalog" className="text-sm font-semibold text-gray-900">
              Wholesale
            </Link>
            <BuyerNav />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">{children}</main>
      </div>
    </BuyerProviders>
  );
}
