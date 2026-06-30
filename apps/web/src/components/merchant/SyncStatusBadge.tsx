'use client';

import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { Tooltip } from '@/components/ui/tooltip';

/**
 * Small, muted Shopify sync indicator for the orders list + detail. Three states:
 *   synced          ✓ Synced        (success green)
 *   sync_pending    ⟳ Syncing…      (muted, spinner)
 *   shopify_orphan  ⚠ Sync failed   (warning, tooltip explains + points to support)
 *
 * Deliberately understated — it sits beside the primary status badge and must not
 * compete with it for attention. Token colors only.
 */
const ORPHAN_TOOLTIP = 'This order could not be synced to Shopify. Contact support.';

export function SyncStatusBadge({ status }: { status: string }): JSX.Element {
  if (status === 'shopify_orphan' || status === 'sync_failed') {
    return (
      <Tooltip content={ORPHAN_TOOLTIP}>
        <span className="inline-flex items-center gap-1 text-xs font-medium text-warning">
          <AlertTriangle className="h-3.5 w-3.5" />
          Sync failed
        </span>
      </Tooltip>
    );
  }
  if (status === 'sync_pending') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-text-tertiary">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Syncing…
      </span>
    );
  }
  if (status === 'synced') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-success">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Synced
      </span>
    );
  }
  return <span className="text-xs text-text-tertiary">{status}</span>;
}
