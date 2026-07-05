import Link from 'next/link';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Global 404 — the App Router renders this for any URL that matches no route. It
 * lives inside the root layout (atmospheric sky + providers) but outside every
 * portal's chrome, so it is a fully self-contained, centered glass card. Neutral
 * by design: it can be reached by a merchant, a buyer, or a stray link, so it
 * points only at the shared home entry.
 */
export default function NotFound(): JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="panel w-full max-w-md p-10 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-ocean-soft">
          <Compass className="h-6 w-6 text-ocean" aria-hidden />
        </div>
        <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary">
          Error 404
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-text-primary">
          This page drifted away
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-text-secondary">
          The page you&apos;re looking for doesn&apos;t exist or has moved. Let&apos;s get you back to solid
          ground.
        </p>
        <Button variant="primary" className="mt-8" asChild>
          <Link href="/">Return home</Link>
        </Button>
      </div>
    </main>
  );
}
