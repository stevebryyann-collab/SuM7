'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageContainer } from '@/components/merchant/PageLayout';

/**
 * Merchant route-group error boundary. The App Router mounts this (a Client
 * Component, as required) when a merchant page or nested layout throws during
 * render. It renders inside the sidebar + top-bar chrome, so it stays a
 * content-level glass panel rather than a full page. `reset()` re-attempts the
 * segment; a dashboard link is the calm escape hatch.
 */
export default function MerchantError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): JSX.Element {
  useEffect(() => {
    // Surface to the console so Sentry's browser SDK captures it via global handlers.
    // eslint-disable-next-line no-console
    console.error('Merchant route error:', error);
  }, [error]);

  return (
    <PageContainer>
      <div className="panel mx-auto my-16 max-w-md p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger-bg">
          <AlertTriangle className="h-5 w-5 text-danger" aria-hidden />
        </div>
        <h2 className="text-lg font-semibold text-text-primary">Something went wrong</h2>
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-text-secondary">
          An unexpected error interrupted this view. You can try again, or head back to your
          dashboard.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button variant="primary" onClick={reset}>
            <RotateCw className="h-4 w-4" />
            Try again
          </Button>
          <Button variant="secondary" asChild>
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        </div>
        {error.digest ? (
          <p className="mt-6 text-2xs uppercase tracking-wide text-text-tertiary">
            Reference <span className="tabular-nums">{error.digest}</span>
          </p>
        ) : null}
      </div>
    </PageContainer>
  );
}
