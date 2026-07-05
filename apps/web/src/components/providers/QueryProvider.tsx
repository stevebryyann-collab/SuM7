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
        position="top-right"
        toastOptions={{
          // Floating glass toast (CLAUDE.md → Notifications): translucent Cloud
          // White over blur, soft glass shadow, generous radius. CSS vars are
          // defined in globals.css :root.
          style: {
            background: 'var(--color-glass-strong)',
            backdropFilter: 'blur(20px) saturate(180%)',
            WebkitBackdropFilter: 'blur(20px) saturate(180%)',
            border: '1px solid var(--color-glass-border)',
            color: 'var(--color-text-primary)',
            borderRadius: '18px',
            fontSize: '14px',
            boxShadow: 'var(--shadow-glass)',
          },
          duration: 4000,
        }}
      />
    </QueryClientProvider>
  );
}
