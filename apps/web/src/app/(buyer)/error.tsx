'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Buyer portal error boundary (Client Component, as the App Router requires).
 * Mounted when a portal page throws during render. It renders inside the buyer
 * header chrome, so it is a content-level glass panel. `reset()` re-attempts the
 * segment; the catalog is the safe way back into the store.
 */
export default function BuyerError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): JSX.Element {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('Buyer portal error:', error);
  }, [error]);

  return (
    <div className="panel mx-auto my-16 max-w-md p-8 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger-bg">
        <AlertTriangle className="h-5 w-5 text-danger" aria-hidden />
      </div>
      <h2 className="text-lg font-semibold text-text-primary">Something went wrong</h2>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-text-secondary">
        We hit a snag loading this page. You can try again, or return to the catalog.
      </p>
      <div className="mt-6 flex items-center justify-center gap-2">
        <Button variant="primary" onClick={reset}>
          <RotateCw className="h-4 w-4" />
          Try again
        </Button>
        <Button variant="secondary" asChild>
          <Link href="/portal/catalog">Back to catalog</Link>
        </Button>
      </div>
      {error.digest ? (
        <p className="mt-6 text-2xs uppercase tracking-wide text-text-tertiary">
          Reference <span className="tabular-nums">{error.digest}</span>
        </p>
      ) : null}
    </div>
  );
}
