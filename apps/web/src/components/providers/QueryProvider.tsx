'use client';

import { useState, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { createQueryClient } from '@/lib/query-client';

/**
 * App-wide client providers shared by BOTH portals: the TanStack Query client
 * and the toast surface. Auth providers are intentionally NOT here — merchant
 * (NextAuth SessionProvider) and buyer (Clerk) auth are mounted separately in
 * their own route-group layouts so the two systems never overlap.
 */
export function QueryProvider({ children }: { children: ReactNode }): JSX.Element {
  // One client per browser session, created lazily so it survives Fast Refresh.
  const [queryClient] = useState(() => createQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster
        position="bottom-right"
        toastOptions={{
          // Solid, non-translucent toasts on the token system (CSS vars defined
          // in globals.css :root). One layer of depth (shadow-md), 8px radius.
          style: {
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-primary)',
            borderRadius: '8px',
            fontSize: '14px',
            boxShadow: 'var(--shadow-md)',
          },
          duration: 4000,
        }}
      />
    </QueryClientProvider>
  );
}
