'use client';

import { Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

/**
 * Masked PII field (tax id, phone). Plaintext is NEVER shipped in the list/detail
 * payload — it is fetched on demand through an audited reveal endpoint owned by
 * the parent panel. This component is purely presentational: it shows `••••••••`
 * until the parent supplies the revealed value, and its Reveal button triggers
 * the parent's confirm-then-fetch flow (which writes a `pii_revealed` audit row).
 *
 *   hasValue   a reveal would return a non-empty value (from hasTaxId/hasPhone)
 *   value      the plaintext, present only once revealed
 *   revealed   the audited reveal has completed for this application
 *   isRevealing the reveal request is in flight
 *   onReveal   ask the parent to run the audited reveal (confirm + fetch)
 */
export interface PiiFieldProps {
  label: string;
  hasValue: boolean;
  value: string | null;
  revealed: boolean;
  isRevealing: boolean;
  onReveal: () => void;
}

export function PiiField({
  label,
  hasValue,
  value,
  revealed,
  isRevealing,
  onReveal,
}: PiiFieldProps): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-label uppercase tracking-wider text-text-secondary">{label}</span>
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm text-text-primary">
          {!hasValue ? '—' : revealed ? value ?? '—' : '••••••••'}
        </span>
        {hasValue && !revealed ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-xs"
            disabled={isRevealing}
            onClick={onReveal}
          >
            {isRevealing ? <Spinner className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            Reveal
          </Button>
        ) : null}
      </div>
    </div>
  );
}
