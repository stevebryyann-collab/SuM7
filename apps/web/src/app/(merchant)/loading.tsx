import { Spinner } from '@/components/ui/spinner';

/** Route-group loading state shown while a merchant page segment streams in. */
export default function MerchantLoading(): JSX.Element {
  return (
    <div
      className="flex min-h-[50vh] items-center justify-center"
      role="status"
      aria-label="Loading page"
    >
      <Spinner className="h-6 w-6 text-gray-400" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
