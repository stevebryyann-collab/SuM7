import type { Metadata, Viewport } from 'next';
import './globals.css';
import { QueryProvider } from '@/components/providers/QueryProvider';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';

export const metadata: Metadata = {
  title: 'Wholesale Portal',
  description: 'B2B wholesale operating system for Shopify merchants and their buyers.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#f9fafb',
};

/**
 * Root layout shared by BOTH portals. It mounts only the portal-agnostic
 * providers (TanStack Query + toasts) and a top-level error boundary. Auth
 * providers are deliberately scoped to their route groups:
 *   - merchant admin → NextAuth SessionProvider
 *   - buyer portal   → Clerk
 * so the two identity systems never overlap (a hard architectural rule).
 */
export default function RootLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="font-sans antialiased">
        <ErrorBoundary>
          <QueryProvider>{children}</QueryProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
