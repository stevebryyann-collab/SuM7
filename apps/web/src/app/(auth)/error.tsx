'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Auth route-group error boundary (Client Component, as required). Mounted when a
 * sign-in / sign-up page throws. It renders inside the centered auth column as a
 * compact glass card; `reset()` re-attempts the segment. No destination link —
 * the entry point (merchant vs buyer login) is ambiguous here, so recovery is a
 * retry.
 */
export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): JSX.Element {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('Auth route error:', error);
  }, [error]);

  return (
    <div className="panel p-8 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger-bg">
        <AlertTriangle className="h-5 w-5 text-danger" aria-hidden />
      </div>
      <h2 className="text-lg font-semibold text-text-primary">We couldn&apos;t load sign in</h2>
      <p className="mx-auto mt-1.5 text-sm text-text-secondary">
        Something interrupted the sign-in screen. Please try again.
      </p>
      <Button variant="primary" className="mt-6 w-full" onClick={reset}>
        <RotateCw className="h-4 w-4" />
        Try again
      </Button>
      {error.digest ? (
        <p className="mt-6 text-2xs uppercase tracking-wide text-text-tertiary">
          Reference <span className="tabular-nums">{error.digest}</span>
        </p>
      ) : null}
    </div>
  );
}
