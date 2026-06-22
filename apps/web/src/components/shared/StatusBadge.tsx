import { cn } from '@/lib/cn';

/**
 * Solid-fill status badge. NEVER outlined, NEVER translucent (design rule):
 * `bg-{color}-100 text-{color}-800`. Covers invoice, order, approval and sync
 * statuses with a sensible neutral fallback.
 */
type BadgeTone = 'green' | 'yellow' | 'orange' | 'red' | 'blue' | 'gray' | 'purple';

const TONE_CLASSES: Record<BadgeTone, string> = {
  green: 'bg-green-100 text-green-800',
  yellow: 'bg-yellow-100 text-yellow-800',
  orange: 'bg-orange-100 text-orange-800',
  red: 'bg-red-100 text-red-800',
  blue: 'bg-blue-100 text-blue-800',
  gray: 'bg-gray-100 text-gray-800',
  purple: 'bg-purple-100 text-purple-800',
};

/** Map a domain status string onto a tone + human label. */
const STATUS_MAP: Record<string, { tone: BadgeTone; label: string }> = {
  // Invoice
  draft: { tone: 'gray', label: 'Draft' },
  sent: { tone: 'blue', label: 'Sent' },
  viewed: { tone: 'blue', label: 'Viewed' },
  partially_paid: { tone: 'yellow', label: 'Partially Paid' },
  paid: { tone: 'green', label: 'Paid' },
  overdue: { tone: 'red', label: 'Overdue' },
  void: { tone: 'gray', label: 'Void' },
  defaulted: { tone: 'red', label: 'Defaulted' },
  // Approval
  pending: { tone: 'yellow', label: 'Pending' },
  approved: { tone: 'green', label: 'Approved' },
  rejected: { tone: 'red', label: 'Rejected' },
  suspended: { tone: 'red', label: 'Suspended' },
  // Order / sync
  confirmed: { tone: 'blue', label: 'Confirmed' },
  processing: { tone: 'yellow', label: 'Processing' },
  fulfilled: { tone: 'green', label: 'Fulfilled' },
  cancelled: { tone: 'gray', label: 'Cancelled' },
  synced: { tone: 'green', label: 'Synced' },
  pending_sync: { tone: 'yellow', label: 'Pending Sync' },
  sync_failed: { tone: 'red', label: 'Sync Failed' },
};

export interface StatusBadgeProps {
  status: string;
  /** Override the displayed label (defaults to the mapped/humanized status). */
  label?: string;
  className?: string;
}

function humanize(status: string): string {
  return status
    .split('_')
    .map((part) => (part.length > 0 ? part[0]!.toUpperCase() + part.slice(1) : part))
    .join(' ');
}

export function StatusBadge({ status, label, className }: StatusBadgeProps): JSX.Element {
  const mapped = STATUS_MAP[status];
  const tone = mapped?.tone ?? 'gray';
  const text = label ?? mapped?.label ?? humanize(status);

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {text}
    </span>
  );
}
