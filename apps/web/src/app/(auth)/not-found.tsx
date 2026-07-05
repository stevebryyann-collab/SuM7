import Link from 'next/link';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Auth route-group 404. Renders inside the centered auth column as a compact
 * glass card pointing back to the canonical merchant sign-in entry point.
 */
export default function AuthNotFound(): JSX.Element {
  return (
    <div className="panel p-8 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-ocean-soft">
        <Compass className="h-5 w-5 text-ocean" aria-hidden />
      </div>
      <h2 className="text-lg font-semibold text-text-primary">Page not found</h2>
      <p className="mx-auto mt-1.5 text-sm text-text-secondary">
        That sign-in link doesn&apos;t exist. Head back to the sign-in screen to continue.
      </p>
      <Button variant="primary" className="mt-6 w-full" asChild>
        <Link href="/merchant-login">Go to sign in</Link>
      </Button>
    </div>
  );
}
