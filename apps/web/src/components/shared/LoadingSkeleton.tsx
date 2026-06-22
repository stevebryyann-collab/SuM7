import { cn } from '@/lib/cn';

/**
 * Animate-pulse skeleton rows whose column proportions match a data table, so
 * the layout doesn't shift when real rows arrive. Solid gray-200 blocks — no
 * shimmer gradient (gradients are forbidden by the design system).
 */
export interface LoadingSkeletonProps {
  /** Number of skeleton rows to render. */
  rows?: number;
  /** Relative width weights per column (e.g. [3,2,2,1] ⇒ a wide first column). */
  columns?: number[];
  className?: string;
}

export function LoadingSkeleton({
  rows = 8,
  columns = [3, 2, 2, 1, 1],
  className,
}: LoadingSkeletonProps): JSX.Element {
  const total = columns.reduce((sum, weight) => sum + weight, 0);

  return (
    <div className={cn('divide-y divide-gray-200', className)} aria-hidden role="presentation">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex items-center gap-4 px-3 py-2.5">
          {columns.map((weight, colIndex) => (
            <div
              key={colIndex}
              className="h-4 animate-pulse rounded bg-gray-200"
              style={{ flexGrow: weight, flexBasis: `${(weight / total) * 100}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
