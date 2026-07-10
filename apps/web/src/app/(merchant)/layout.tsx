import type { ReactNode } from 'react';
import { MerchantSessionProvider } from '@/components/providers/MerchantSessionProvider';
import { Sidebar } from '@/components/merchant/Sidebar';
import { MerchantTopbar } from '@/components/merchant/MerchantTopbar';

/**
 * Merchant admin route-group layout. Wraps the subtree in the NextAuth
 * SessionProvider (merchant identity ONLY — buyers never see this) and renders
 * the fixed 220px Sidebar + top bar (avatar dropdown / sign-out). The content
 * column is offset by the sidebar width; per-page spacing (max-width, padding,
 * header) is owned by {@link PageLayout}, so `<main>` is a bare flex container.
 */
export default function MerchantLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <MerchantSessionProvider>
      {/* Transparent so the atmospheric sky painted on <body> shows through the
          glass chrome (CLAUDE.md → Background System). */}
      <div className="min-h-screen">
        <Sidebar />
        <div className="flex min-h-screen min-w-0 flex-col pl-[220px]">
          <MerchantTopbar />
          <main className="flex-1 overflow-x-hidden">{children}</main>
        </div>
      </div>
    </MerchantSessionProvider>
  );
}
