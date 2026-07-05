'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Root segment error boundary (App Router). Catches render/data errors thrown
 * anywhere below the root layout and offers a retry without a full reload.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): JSX.Element {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('Route error:', error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="panel w-full max-w-md p-8 text-center">
        <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
          <AlertTriangle className="h-5 w-5 text-red-700" aria-hidden />
        </div>
        <h1 className="text-base font-semibold text-gray-900">Something went wrong</h1>
        <p className="mt-1 text-sm leading-relaxed text-gray-500">
          An unexpected error occurred. Try again, or refresh the page if the problem persists.
        </p>
        {error.digest ? (
          <p className="mt-2 font-mono text-xs text-gray-400">Ref: {error.digest}</p>
        ) : null}
        <div className="mt-5 flex justify-center gap-2">
          <Button variant="primary" onClick={reset}>
            Try again
          </Button>
          <Button onClick={() => window.location.reload()}>Refresh page</Button>
        </div>
      </div>
    </div>
  );
}
