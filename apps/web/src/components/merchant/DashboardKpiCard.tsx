'use client';

import Link from 'next/link';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * A single dashboard KPI card. Minimal: white surface, 1px border, NO shadow on
 * the container (depth is reserved for interactive elements). Title is the 11px
 * uppercase label; value is the 28px `kpi` size in tabular figures. The optional
 * change indicator is success (up) / danger (down); `badgePulse` uses the CSS
 * `animate-ping` ring only — never JS animation.
 */
export interface DashboardKpiCardProps {
  title: string;
  value: string | number;
  /** Inline prefix shown before the value (e.g. "$"), same size/color. */
  valuePrefix?: string;
  changePercent?: number | string | null;
  changePeriod?: string;
  link?: string;
  badgeCount?: number;
  badgePulse?: boolean;
  /** When true and value > 0, the figure is shown in danger red (e.g. overdue). */
  danger?: boolean;
  /** Secondary line under the value (e.g. "across 7 invoices"). */
  subLabel?: string;
  /** Legacy alias: `tone="danger"` is equivalent to `danger`. */
  tone?: 'accent' | 'danger';
}

function parseChange(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

/** Best-effort numeric read of a value that may be a formatted money string. */
function numericValue(value: string | number): number {
  if (typeof value === 'number') return value;
  const cleaned = value.replace(/[^0-9.-]/g, '');
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

export function DashboardKpiCard({
  title,
  value,
  valuePrefix,
  changePercent,
  changePeriod,
  link,
  badgeCount,
  badgePulse = false,
  danger: dangerProp = false,
  subLabel,
  tone,
}: DashboardKpiCardProps): JSX.Element {
  const change = parseChange(changePercent);
  const isUp = change !== null && change >= 0;
  const danger = dangerProp || tone === 'danger';
  const showDangerValue = danger && numericValue(value) > 0;
  const hasBadge = typeof badgeCount === 'number' && badgeCount > 0;

  const body = (
    <div
      className={cn(
        'flex flex-col rounded-lg border border-border bg-surface p-5',
        link && 'cursor-pointer transition-colors duration-fast hover:border-border-strong',
      )}
    >
      <span className="mb-2 text-2xs font-medium uppercase tracking-wider text-text-secondary">{title}</span>

      <div className="flex items-center gap-2">
        <span
          className={cn(
            'text-kpi font-semibold tabular-nums',
            showDangerValue ? 'text-danger' : 'text-text-primary',
          )}
        >
          {valuePrefix ? <span>{valuePrefix}</span> : null}
          {value}
        </span>

        {hasBadge ? (
          <span className="relative inline-flex">
            {badgePulse ? (
              <span className="absolute inset-0 inline-flex animate-ping rounded-sm bg-danger opacity-75" aria-hidden />
            ) : null}
            <span className="relative inline-flex items-center rounded-sm bg-danger px-1.5 py-0.5 text-2xs font-medium text-white">
              {badgeCount}
            </span>
          </span>
        ) : null}
      </div>

      {change !== null ? (
        <div className="mt-1.5 flex items-center gap-1">
          {isUp ? (
            <ChevronUp className="h-3.5 w-3.5 text-success" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-danger" />
          )}
          <span className={cn('text-xs font-medium', isUp ? 'text-success' : 'text-danger')}>
            {Math.abs(change).toFixed(1)}%
          </span>
          {changePeriod ? <span className="text-xs text-text-secondary">{changePeriod}</span> : null}
        </div>
      ) : null}

      {subLabel ? <span className="mt-1.5 text-xs text-text-secondary">{subLabel}</span> : null}
    </div>
  );

  if (link) {
    return (
      <Link
        href={link}
        className="block rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        {body}
      </Link>
    );
  }
  return body;
}
