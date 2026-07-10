'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Minimal click-to-open popover — no Radix/Floating-UI dependency (the web bundle
 * keeps its dep surface small; see the BulkOrderTable volume breakdown). Anchored
 * to its trigger via a relative wrapper, dismissed on outside-pointerdown or Escape.
 * Glass panel over blur (CLAUDE.md → Glass System).
 */
export interface PopoverProps {
  /** Content rendered inside the trigger button (e.g. an info icon). */
  trigger: ReactNode;
  /** Panel content. */
  children: ReactNode;
  /** Accessible label for the trigger button. */
  label: string;
  /** Horizontal edge the panel aligns to. */
  align?: 'start' | 'end';
  /** Vertical side the panel opens toward. */
  side?: 'top' | 'bottom';
  /** Class names for the panel. */
  className?: string;
  /** Class names for the trigger button. */
  triggerClassName?: string;
}

export function Popover({
  trigger,
  children,
  label,
  align = 'start',
  side = 'bottom',
  className,
  triggerClassName,
}: PopoverProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <span ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'inline-flex items-center justify-center rounded-full text-text-tertiary transition-colors duration-fast',
          'hover:text-ocean focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean/40',
          triggerClassName,
        )}
      >
        {trigger}
      </button>
      {open ? (
        <div
          role="dialog"
          className={cn(
            'absolute z-50 rounded-lg border border-glass-border bg-glass-strong shadow-glass backdrop-blur-glass',
            'animate-in fade-in-0 zoom-in-95',
            side === 'top' ? 'bottom-full mb-1' : 'top-full mt-1',
            align === 'end' ? 'right-0' : 'left-0',
            className,
          )}
          data-state="open"
        >
          {children}
        </div>
      ) : null}
    </span>
  );
}
