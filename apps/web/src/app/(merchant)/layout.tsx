import type { ReactNode } from 'react';
import { MerchantSessionProvider } from '@/components/providers/MerchantSessionProvider';
import { MerchantNav } from '@/components/merchant/MerchantNav';
import { MerchantTopbar } from '@/components/merchant/MerchantTopbar';

/**
 * Merchant admin route-group layout. Wraps the subtree in the NextAuth
 * SessionProvider (merchant identity ONLY — buyers never see this) and renders
 * the persistent sidebar, top bar (avatar dropdown) + content area. Page
 * background is gray-50; content panels are white.
 */
export default function MerchantLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <MerchantSessionProvider>
      <div className="flex min-h-screen bg-background">
        <MerchantNav />
        <div className="flex min-w-0 flex-1 flex-col">
          <MerchantTopbar />
          <main className="flex-1 overflow-x-hidden">
            <div className="mx-auto max-w-7xl px-6 py-6">{children}</div>
          </main>
        </div>
      </div>
    </MerchantSessionProvider>
  );
}
