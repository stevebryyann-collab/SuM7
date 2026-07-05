import type {
  HTMLAttributes,
  ReactNode,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from 'react';
import { cn } from '@/lib/cn';

/**
 * DataTable — a styled wrapper set for native `<table>` markup that enforces the
 * design-system table rules in one place. This is NOT a data-grid: callers still
 * write rows/cells, but every surface, border, and alignment is centralized.
 *
 * RULE: financial figures must use `align="right"`, which automatically applies
 * `.tabular-nums` (JetBrains Mono + tabular figures). This is enforced at the
 * cell level so numbers always align on the decimal.
 */

type Align = 'left' | 'right' | 'center';

const ALIGN_CLASS: Record<Align, string> = {
  left: 'text-left',
  right: 'text-right tabular-nums',
  center: 'text-center',
};

export function DataTable({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLTableElement>): JSX.Element {
  return (
    <div className="overflow-hidden rounded-xl border border-glass-border bg-glass shadow-glass backdrop-blur-glass">
      <table className={cn('w-full border-collapse', className)} {...props}>
        {children}
      </table>
    </div>
  );
}

export function DataTableHeader({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>): JSX.Element {
  return (
    <thead className={cn('bg-white/40', className)} {...props}>
      {children}
    </thead>
  );
}

export interface DataTableHeaderCellProps
  extends Omit<ThHTMLAttributes<HTMLTableCellElement>, 'align'> {
  align?: Align;
}

export function DataTableHeaderCell({
  className,
  align = 'left',
  children,
  ...props
}: DataTableHeaderCellProps): JSX.Element {
  return (
    <th
      className={cn(
        'px-4 py-2.5 text-2xs font-medium uppercase tracking-wider text-text-secondary',
        ALIGN_CLASS[align],
        className,
      )}
      {...props}
    >
      {children}
    </th>
  );
}

export function DataTableBody({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>): JSX.Element {
  return (
    <tbody className={className} {...props}>
      {children}
    </tbody>
  );
}

export interface DataTableRowProps extends HTMLAttributes<HTMLTableRowElement> {
  /** Adds cursor-pointer; pair with an onClick to make the whole row navigate. */
  clickable?: boolean;
}

export function DataTableRow({
  className,
  clickable = false,
  children,
  ...props
}: DataTableRowProps): JSX.Element {
  return (
    <tr
      className={cn(
        'border-b border-border/70 transition-colors duration-fast last:border-b-0 hover:bg-ocean-soft',
        clickable ? 'cursor-pointer' : 'cursor-default',
        className,
      )}
      {...props}
    >
      {children}
    </tr>
  );
}

export interface DataTableCellProps
  extends Omit<TdHTMLAttributes<HTMLTableCellElement>, 'align'> {
  align?: Align;
}

export function DataTableCell({
  className,
  align = 'left',
  children,
  ...props
}: DataTableCellProps): JSX.Element {
  return (
    <td className={cn('px-4 py-3 text-base text-text-primary', ALIGN_CLASS[align], className)} {...props}>
      {children}
    </td>
  );
}

export interface DataTableEmptyProps {
  /** Must span every column so the message centers across the full table width. */
  colSpan: number;
  /** Optional icon rendered above the message. */
  icon?: ReactNode;
  /** Primary empty-state line. */
  title?: string;
  /** Secondary description line. */
  message?: string;
  className?: string;
}

export function DataTableEmpty({
  colSpan,
  icon,
  title,
  message,
  className,
}: DataTableEmptyProps): JSX.Element {
  return (
    <tr>
      <td colSpan={colSpan} className={cn('px-4 py-12 text-center', className)}>
        <div className="flex flex-col items-center justify-center gap-2">
          {icon ? <span className="text-text-tertiary">{icon}</span> : null}
          {title ? <p className="text-base font-medium text-text-primary">{title}</p> : null}
          {message ? <p className="max-w-xs text-sm text-text-secondary">{message}</p> : null}
        </div>
      </td>
    </tr>
  );
}
