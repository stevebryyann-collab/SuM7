import { cn } from '@/lib/cn';
import { DataTable, DataTableBody } from '@/components/shared/DataTable';

/**
 * Content-aware skeletons. The base atom is a glass block with a travelling
 * shimmer band (`.skeleton-shimmer` in globals.css) — the Apple-Weather loading
 * treatment (CLAUDE.md → Loading States). Each exported skeleton matches the
 * shape of the content it stands in for, so layout does not shift when real
 * data arrives.
 */

/** Single skeleton block. */
export function SkeletonBar({ className, style }: { className?: string; style?: React.CSSProperties }): JSX.Element {
  return <div className={cn('skeleton-shimmer rounded-md', className)} style={style} aria-hidden />;
}

export interface LoadingSkeletonProps {
  /** Number of skeleton rows to render. */
  rows?: number;
  /** Relative width weights per column (e.g. [3,2,2,1] ⇒ a wide first column). */
  columns?: number[];
  className?: string;
}

/**
 * Generic weighted-row skeleton (kept from the original API — used wherever a
 * column-proportioned placeholder is enough). For table-shaped placeholders use
 * the dedicated table skeletons below.
 */
export function LoadingSkeleton({
  rows = 8,
  columns = [3, 2, 2, 1, 1],
  className,
}: LoadingSkeletonProps): JSX.Element {
  const total = columns.reduce((sum, weight) => sum + weight, 0);

  return (
    <div className={cn('divide-y divide-border', className)} aria-hidden role="presentation">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex items-center gap-4 px-3 py-2.5">
          {columns.map((weight, colIndex) => (
            <SkeletonBar
              key={colIndex}
              className="h-4"
              style={{ flexGrow: weight, flexBasis: `${(weight / total) * 100}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Four KPI-card placeholders, matching the dashboard KPI grid. */
export function KpiCardSkeleton(): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-hidden role="presentation">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-glass-border bg-glass p-5 shadow-glass backdrop-blur-glass">
          <SkeletonBar className="h-2.5 w-20" />
          <SkeletonBar className="mt-3 h-8 w-28" />
          <SkeletonBar className="mt-3 h-2.5 w-24" />
        </div>
      ))}
    </div>
  );
}

/** A single table row of skeleton cells at the given pixel widths. */
export function TableRowSkeleton({ columns }: { columns: number[] }): JSX.Element {
  return (
    <tr className="border-b border-border last:border-b-0" aria-hidden>
      {columns.map((width, i) => (
        <td key={i} className="px-4 py-3">
          <SkeletonBar className="h-3.5" style={{ width: `${width}px` }} />
        </td>
      ))}
    </tr>
  );
}

const INVOICE_COLUMNS = [110, 180, 90, 90, 80, 60];
const BUYER_COLUMNS = [200, 90, 130, 110, 70];

/** Invoice-table placeholder (Invoice · Buyer · Amount · Due · Status · Action). */
export function InvoiceTableSkeleton({ rows = 5 }: { rows?: number }): JSX.Element {
  return (
    <DataTable>
      <DataTableBody>
        {Array.from({ length: rows }).map((_, i) => (
          <TableRowSkeleton key={i} columns={INVOICE_COLUMNS} />
        ))}
      </DataTableBody>
    </DataTable>
  );
}

/** Buyer-table placeholder (Company · Status · Tier · Applied · Action). */
export function BuyerTableSkeleton({ rows = 5 }: { rows?: number }): JSX.Element {
  return (
    <DataTable>
      <DataTableBody>
        {Array.from({ length: rows }).map((_, i) => (
          <TableRowSkeleton key={i} columns={BUYER_COLUMNS} />
        ))}
      </DataTableBody>
    </DataTable>
  );
}

/** Full-width chart placeholder at a fixed pixel height. */
export function ChartSkeleton({ height }: { height: number }): JSX.Element {
  return <SkeletonBar className="w-full" style={{ height: `${height}px` }} />;
}

/** Page title + subtitle placeholder, matching {@link PageLayout}'s header. */
export function PageHeaderSkeleton(): JSX.Element {
  return (
    <div aria-hidden role="presentation">
      <SkeletonBar className="h-7 w-48" />
      <SkeletonBar className="mt-2 h-4 w-32" />
    </div>
  );
}
