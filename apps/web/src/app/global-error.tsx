'use client';

import { useEffect } from 'react';

/**
 * Last-resort error boundary that replaces the ROOT LAYOUT when it crashes.
 * Must render its own <html>/<body> and cannot rely on app CSS being present,
 * so styles are inlined.
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
    console.error('Global error:', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f9fafb',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <div style={{ textAlign: 'center', padding: 32, maxWidth: 400 }}>
          <h1 style={{ fontSize: 16, fontWeight: 600, color: '#111827', margin: 0 }}>
            Application error
          </h1>
          <p style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.5, marginTop: 8 }}>
            A critical error occurred while loading the app.
          </p>
          {error.digest ? (
            <p style={{ fontSize: 12, color: '#9ca3af', fontFamily: 'monospace', marginTop: 8 }}>
              Ref: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 20,
              padding: '8px 16px',
              fontSize: 14,
              fontWeight: 500,
              color: '#ffffff',
              background: '#1f2937',
              border: '1px solid #111827',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
