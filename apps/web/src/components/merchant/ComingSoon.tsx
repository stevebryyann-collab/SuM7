import { Hammer } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';

/**
 * Placeholder for merchant routes whose full implementation lands in a later
 * group (Analytics, Settings, Billing). Keeps every nav/dropdown link reachable
 * — no 404s — while signalling the screen is not yet built. Replaced wholesale
 * when the real page ships.
 */
export function ComingSoon({
  title,
  description,
}: {
  title: string;
  description: string;
}): JSX.Element {
  return (
    <>
      <PageHeader title={title} description={description} />
      <section className="panel flex flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-fog-soft">
          <Hammer className="h-6 w-6 text-text-secondary" />
        </div>
        <h2 className="text-base font-semibold text-text-primary">Coming soon</h2>
        <p className="mt-1 max-w-sm text-sm text-text-secondary">
          This screen is on the way. The data and actions it needs are already wired on the backend.
        </p>
      </section>
    </>
  );
}
