'use client';

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { MoreVertical, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Dependency-free dropdown menu — same hand-rolled approach as {@link Popover}
 * and {@link Tooltip} (the web bundle deliberately avoids `@radix-ui/react-
 * dropdown-menu`, which is not in the locked stack). The panel renders through a
 * portal with fixed positioning so it is never clipped by an `overflow-hidden`
 * ancestor (the {@link DataTable} wrapper clips its rounded corners). Right-
 * aligned to the trigger; flips above when near the viewport bottom. Dismissed on
 * outside-pointerdown, Escape, scroll, or resize. Solid surface, one layer of
 * depth, no blur (design rules).
 */

const MENU_WIDTH = 200;
const FLIP_MARGIN = 260;

interface DropdownContextValue {
  close: () => void;
}

const DropdownContext = createContext<DropdownContextValue | null>(null);

export interface DropdownMenuProps {
  /** Menu items (use {@link DropdownMenuItem} / {@link DropdownMenuSeparator}). */
  children: ReactNode;
  /** Custom trigger content; defaults to a ghost ellipsis icon button. */
  trigger?: ReactNode;
  /** Accessible label for the default trigger button. */
  label?: string;
  className?: string;
  triggerClassName?: string;
}

export function DropdownMenu({
  children,
  trigger,
  label = 'Open menu',
  className,
  triggerClassName,
}: DropdownMenuProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; flip: boolean }>({
    top: 0,
    left: 0,
    flip: false,
  });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const position = (): void => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const flip = rect.bottom > window.innerHeight - FLIP_MARGIN;
    setCoords({
      top: flip ? rect.top : rect.bottom + 4,
      left: Math.max(8, rect.right - MENU_WIDTH),
      flip,
    });
  };

  useLayoutEffect(() => {
    if (open) position();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onReflow = (): void => setOpen(false);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onReflow, true);
    window.addEventListener('resize', onReflow);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onReflow, true);
      window.removeEventListener('resize', onReflow);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-md text-text-secondary',
          'transition-colors duration-fast hover:bg-neutral-bg hover:text-text-primary',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent',
          triggerClassName,
        )}
      >
        {trigger ?? <MoreVertical className="h-4 w-4" />}
      </button>

      {open && mounted
        ? createPortal(
            <DropdownContext.Provider value={{ close: () => setOpen(false) }}>
              <div
                ref={panelRef}
                role="menu"
                onClick={(event) => event.stopPropagation()}
                style={{
                  top: coords.flip ? undefined : coords.top,
                  bottom: coords.flip ? window.innerHeight - coords.top + 4 : undefined,
                  left: coords.left,
                  width: MENU_WIDTH,
                }}
                className={cn(
                  'fixed z-50 overflow-hidden rounded-md border border-border bg-surface py-1 shadow-md',
                  'animate-fade-in',
                  className,
                )}
              >
                {children}
              </div>
            </DropdownContext.Provider>,
            document.body,
          )
        : null}
    </>
  );
}

export interface DropdownMenuItemProps {
  children: ReactNode;
  onSelect?: () => void;
  href?: string;
  disabled?: boolean;
  /** Renders the item in danger red (for irreversible actions). */
  destructive?: boolean;
  icon?: LucideIcon;
  /** Native title (used to explain a disabled item, e.g. a reminder cooldown). */
  title?: string;
}

export function DropdownMenuItem({
  children,
  onSelect,
  href,
  disabled = false,
  destructive = false,
  icon: Icon,
  title,
}: DropdownMenuItemProps): JSX.Element {
  const ctx = useContext(DropdownContext);

  const classes = cn(
    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors duration-fast',
    disabled
      ? 'cursor-not-allowed text-text-tertiary'
      : destructive
        ? 'text-danger hover:bg-danger-bg'
        : 'text-text-primary hover:bg-neutral-bg',
  );

  const content = (
    <>
      {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" /> : null}
      <span className="truncate">{children}</span>
    </>
  );

  if (href && !disabled) {
    return (
      <Link href={href} role="menuitem" className={classes} title={title} onClick={() => ctx?.close()}>
        {content}
      </Link>
    );
  }

  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      title={title}
      className={classes}
      onClick={() => {
        if (disabled) return;
        onSelect?.();
        ctx?.close();
      }}
    >
      {content}
    </button>
  );
}

export function DropdownMenuSeparator(): JSX.Element {
  return <div role="separator" className="my-1 h-px bg-border" />;
}

export function DropdownMenuLabel({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="px-3 py-1 text-2xs font-medium uppercase tracking-wider text-text-tertiary">
      {children}
    </div>
  );
}
