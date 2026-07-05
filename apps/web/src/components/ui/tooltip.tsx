'use client';

import { useId, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Minimal hover/focus tooltip — no Radix dependency. The wrapper is focusable so
 * the tip is reachable by keyboard (`aria-describedby` links it to the trigger).
 * Glass surface over blur (CLAUDE.md → Glass System). Used for the percentage-off
 * badge ("Original price … You save X%") and the unavailable hint.
 */
export interface TooltipProps {
  /** Tooltip body. */
  content: ReactNode;
  /** The element the tooltip describes. */
  children: ReactNode;
  /** Side the tip opens toward. */
  side?: 'top' | 'bottom';
  /** Class names for the tooltip panel. */
  className?: string;
}

export function Tooltip({ content, children, side = 'top', className }: TooltipProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span
      className="relative inline-flex"
      tabIndex={0}
      aria-describedby={open ? id : undefined}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open ? (
        <span
          role="tooltip"
          id={id}
          className={cn(
            'pointer-events-none absolute left-1/2 z-50 w-max max-w-xs -translate-x-1/2 rounded-lg',
            'border border-glass-border bg-glass-strong px-2.5 py-1.5 text-xs leading-snug text-text-primary shadow-glass backdrop-blur-glass',
            'animate-in fade-in-0 zoom-in-95',
            side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
            className,
          )}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}
