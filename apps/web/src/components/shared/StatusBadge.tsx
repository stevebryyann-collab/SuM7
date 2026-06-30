import { cn } from '@/lib/cn';

/**
 * Status badge — solid-fill, bordered, 11px uppercase. NEVER outlined-only,
 * NEVER translucent (design rule). Color is chosen purely from the `status`
 * string; the optional `variant` is context for future per-domain extensions
 * and does not affect the mapping today.
 *
 * Token colors only (success/warning/danger/neutral/accent), with two semantic
 * exceptions that have no token equivalent: `viewed` (purple) and `back_order`
 * (orange) — these mirror the explicit PART 1 status spec.
 */
export type StatusBadgeVariant = 'invoice' | 'order' | 'application' | 'buyer' | 'inventory';

/** status string → solid bg + text + border classes. */
const STATUS_CLASSES: Record<string, string> = {
  // Invoice
  paid: 'bg-success-bg text-success border-success-border',
  overdue: 'bg-danger-bg text-danger border-danger-border',
  sent: 'bg-accent-subtle text-accent border-accent-border',
  viewed: 'bg-purple-50 text-purple-700 border-purple-200',
  partially_paid: 'bg-warning-bg text-warning border-warning-border',
  void: 'bg-neutral-bg text-neutral border-border-strong',
  draft: 'bg-neutral-bg text-neutral border-border-strong',
  defaulted: 'bg-danger-bg text-danger border-danger-border',
  // Application / buyer
  pending: 'bg-warning-bg text-warning border-warning-border',
  approved: 'bg-success-bg text-success border-success-border',
  rejected: 'bg-neutral-bg text-neutral border-border-strong',
  suspended: 'bg-danger-bg text-danger border-danger-border',
  // Order
  confirmed: 'bg-accent-subtle text-accent border-accent-border',
  processing: 'bg-warning-bg text-warning border-warning-border',
  fulfilled: 'bg-success-bg text-success border-success-border',
  cancelled: 'bg-neutral-bg text-neutral border-border-strong',
  back_order: 'bg-orange-50 text-orange-700 border-orange-200',
  // Inventory
  in_stock: 'bg-success-bg text-success border-success-border',
  low_stock: 'bg-warning-bg text-warning border-warning-border',
  out_of_stock: 'bg-danger-bg text-danger border-danger-border',
  // Shopify sync
  synced: 'bg-success-bg text-success border-success-border',
  pending_sync: 'bg-warning-bg text-warning border-warning-border',
  sync_failed: 'bg-danger-bg text-danger border-danger-border',
};

const NEUTRAL_CLASSES = 'bg-neutral-bg text-neutral border-border-strong';

export interface StatusBadgeProps {
  status: string;
  /** Optional context for future per-domain mappings (not used for coloring yet). */
  variant?: StatusBadgeVariant;
  /** Override the displayed label (defaults to the humanized status). */
  label?: string;
  className?: string;
}

function humanize(status: string): string {
  return status
    .split('_')
    .map((part) => (part.length > 0 ? part[0]!.toUpperCase() + part.slice(1) : part))
    .join(' ');
}

export function StatusBadge({ status, variant: _variant, label, className }: StatusBadgeProps): JSX.Element {
  const classes = STATUS_CLASSES[status] ?? NEUTRAL_CLASSES;
  const text = label ?? humanize(status);

  return (
    <span
      className={cn(
        'inline-flex items-center rounded border px-1.5 py-0.5 text-2xs font-medium uppercase',
        classes,
        className,
      )}
    >
      {text}
    </span>
  );
}
