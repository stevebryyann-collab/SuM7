'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';

/**
 * Global error boundary — the last line of defense. The App Router mounts this
 * ONLY when the root layout itself throws, which is why it must render its own
 * <html> and <body> (it replaces the root layout entirely). App-wide global CSS
 * is still injected, so the glass tokens resolve and this stays on-brand even in
 * the catastrophic case. No design-system component is imported here to avoid
 * depending on anything that might have contributed to the failure.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): JSX.Element {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('Global (root layout) error:', error);
  }, [error]);

  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <main className="flex min-h-screen items-center justify-center px-4">
          <div className="panel w-full max-w-md p-10 text-center">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-danger-bg">
              <AlertTriangle className="h-6 w-6 text-danger" aria-hidden />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-text-primary">
              Something went wrong
            </h1>
            <p className="mx-auto mt-2 max-w-sm text-sm text-text-secondary">
              A critical error interrupted the application. Reloading usually clears it.
            </p>
            <button
              type="button"
              onClick={reset}
              className="btn-primary mx-auto mt-8"
            >
              <RotateCw className="h-4 w-4" />
              Reload application
            </button>
            {error.digest ? (
              <p className="mt-6 text-2xs uppercase tracking-wide text-text-tertiary">
                Reference <span className="tabular-nums">{error.digest}</span>
              </p>
            ) : null}
          </div>
        </main>
      </body>
    </html>
  );
}
