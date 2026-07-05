'use client';

import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { cn } from '@/lib/cn';

interface CopyButtonProps {
  /** The text written to the clipboard on click. */
  value: string;
  /** Optional label shown next to the icon (e.g. "Copy link"). */
  label?: string;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Ghost copy button with the platform-wide copied affordance: on click the icon
 * swaps Copy → Check (success green) and the label becomes "Copied!" for 2s. The
 * swap is an instant state change (no animation), per the design rules. Every
 * copy affordance in the app routes through this so the behavior is identical
 * everywhere (application link, tracking number, discount code, invoice number).
 */
export function CopyButton({ value, label, size = 'md', className }: CopyButtonProps): JSX.Element {
  const { copy, copied } = useCopyToClipboard();

  return (
    <Button
      type="button"
      variant="ghost"
      size={size === 'sm' ? 'sm' : 'default'}
      onClick={() => void copy(value)}
      aria-label={label ?? 'Copy to clipboard'}
      className={cn(className)}
    >
      {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
      {copied ? 'Copied!' : label}
    </Button>
  );
}
