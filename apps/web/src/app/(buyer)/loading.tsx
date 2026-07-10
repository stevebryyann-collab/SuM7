import { SkeletonBar, LoadingSkeleton } from '@/components/shared/LoadingSkeleton';

/**
 * Buyer portal loading fallback. Rendered inside the white-labeled buyer header
 * chrome while a portal page streams. Mirrors the standard buyer page shape (a
 * header line + a glass panel of rows) so nothing jumps when data arrives —
 * shimmering glass, never a spinner (CLAUDE.md → Loading States).
 */
export default function BuyerLoading(): JSX.Element {
  return (
    <div>
      <div className="mb-6">
        <SkeletonBar className="h-6 w-44" />
        <SkeletonBar className="mt-2 h-3.5 w-60" />
      </div>
      <section className="panel overflow-hidden p-2">
        <LoadingSkeleton rows={6} columns={[3, 2, 2, 1]} />
      </section>
    </div>
  );
}
