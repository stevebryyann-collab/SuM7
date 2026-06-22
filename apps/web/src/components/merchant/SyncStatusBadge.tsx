'use client';

import { AlertTriangle, Check, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Small, muted Shopify sync indicator for the orders list + detail. Three states:
 *   synced          ✓ Synced        (muted green)
 *   sync_pending    ⟳ Syncing…      (muted gray)
 *   shopify_orphan  ⚠ Sync failed   (orange, tooltip explains + points to support)
 *
 * Deliberately understated — it sits beside the primary status badge and must not
 * compete with it for attention.
 */
const ORPHAN_TOOLTIP = 'This order could not be synced to Shopify. Contact support.';

export function SyncStatusBadge({ status }: { status: string }): JSX.Element {
  if (status === 'shopify_orphan') {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs font-medium text-orange-600"
        title={ORPHAN_TOOLTIP}
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        Sync failed
      </span>
    );
  }
  if (status === 'sync_pending') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-gray-500">
        <RefreshCw className="h-3.5 w-3.5" />
        Syncing…
      </span>
    );
  }
  if (status === 'synced') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-700">
        <Check className="h-3.5 w-3.5" />
        Synced
      </span>
    );
  }
  return <span className={cn('text-xs text-gray-400')}>{status}</span>;
}
