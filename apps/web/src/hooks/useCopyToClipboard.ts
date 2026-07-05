'use client';

import { useCallback, useState } from 'react';

/**
 * Copy-to-clipboard with a transient "copied" flag. `copied` flips true on a
 * successful write and auto-resets after `resetDelay` ms. Backs {@link CopyButton}
 * and any inline copy affordance (application link, tracking number, invoice #,
 * discount code). The write is guarded so a clipboard-permission rejection can
 * never surface as an unhandled promise rejection.
 */
export function useCopyToClipboard(resetDelay = 2000): {
  copy: (text: string) => Promise<void>;
  copied: boolean;
} {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(
    async (text: string): Promise<void> => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), resetDelay);
      } catch {
        setCopied(false);
      }
    },
    [resetDelay],
  );

  return { copy, copied };
}
