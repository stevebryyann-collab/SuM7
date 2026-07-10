'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { clearRepSession, readRepSession, type RepSessionInfo } from '@/lib/rep-session';

/**
 * Persistent warning banner shown across the buyer portal while a sales rep is
 * impersonating a buyer. Sits in normal flow (sticky) so it pushes the portal
 * content down and stays pinned on scroll. "End session" clears the rep token
 * from sessionStorage — which immediately stops {@link file://../../lib/api/buyer.ts}
 * from forwarding the `X-Sales-Rep-Session` header — and reloads.
 *
 * NOTE (CLAUDE.md compliance): ending impersonation is intentionally a
 * client-only action. The merchant-auth `DELETE /rep/sessions/:token` route is
 * never called from here because the buyer portal must not touch the merchant
 * (NextAuth) auth context — the two auth systems are kept strictly separate. The
 * server-side session simply lapses (4h TTL) or is ended from the merchant side.
 */
export function RepSessionBanner(): JSX.Element | null {
  const [session, setSession] = useState<RepSessionInfo | null>(null);

  useEffect(() => {
    setSession(readRepSession());
  }, []);

  if (!session) return null;

  function endSession(): void {
    clearRepSession();
    window.location.reload();
  }

  return (
    <div className="sticky top-0 z-50 flex h-10 items-center justify-between gap-3 bg-warning px-4 text-sm text-white">
      <span className="flex min-w-0 items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        <span className="truncate">
          You are placing an order on behalf of <strong>{session.buyerName}</strong>. This order
          will be recorded as placed by your sales rep account.
        </span>
      </span>
      <button
        type="button"
        onClick={endSession}
        className="shrink-0 rounded-md border border-white/40 px-2.5 py-1 text-xs font-medium transition-colors duration-fast hover:bg-white/10"
      >
        End session
      </button>
    </div>
  );
}
