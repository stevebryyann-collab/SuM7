import { format, formatDistanceToNowStrict, isValid, parseISO } from 'date-fns';

/**
 * Presentation helpers. All monetary values arrive from the API as decimal
 * STRINGS (computed server-side with Decimal.js, ROUND_HALF_EVEN). The frontend
 * never does money arithmetic — it only formats. Parsing to a JS number here is
 * for `Intl.NumberFormat` display only and never feeds back into a write.
 */

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format a decimal money string (or number) as USD. Falls back to `$0.00`. */
export function formatMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return USD.format(0);
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return USD.format(0);
  return USD.format(num);
}

/** Compact money for chart axes/tooltips (e.g. $12.3k, $1.2M). */
export function formatMoneyCompact(value: string | number | null | undefined): string {
  const num = typeof value === 'number' ? value : Number(value ?? 0);
  if (!Number.isFinite(num)) return '$0';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(num);
}

/** A signed, 1-decimal percent string (e.g. `+12.4%`, `-3.0%`). */
export function formatPercentChange(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return null;
  const sign = num > 0 ? '+' : '';
  return `${sign}${num.toFixed(1)}%`;
}

/** Parse an API ISO date string defensively (returns null when unparseable). */
function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : parseISO(value);
  return isValid(date) ? date : null;
}

/** Short date for tables/charts, e.g. `Jun 15, 2026`. */
export function formatDate(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? format(date, 'MMM d, yyyy') : '—';
}

/** Compact axis date, e.g. `Jun 15`. */
export function formatDateShort(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? format(date, 'MMM d') : '';
}

/** Relative age for "last activity" columns, e.g. `3 days ago`. */
export function formatRelative(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? `${formatDistanceToNowStrict(date)} ago` : '—';
}

/** Number of whole days a due date is overdue (0 when not yet due). */
export function daysOverdue(dueDate: string | Date | null | undefined): number {
  const date = toDate(dueDate);
  if (!date) return 0;
  const diffMs = Date.now() - date.getTime();
  return diffMs <= 0 ? 0 : Math.floor(diffMs / (1000 * 60 * 60 * 24));
}
