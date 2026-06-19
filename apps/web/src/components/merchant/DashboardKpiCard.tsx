'use client';

import Link from 'next/link';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * A single dashboard KPI card. Minimal: white panel, 1px border, NO shadow on
 * the container itself (depth is reserved for interactive elements). Title is
 * the 11px uppercase label; value is 28px semibold. The optional change indicator
 * is green (up) / red (down); `badgePulse` uses the CSS animate-ping ring only —
 * never JS animation.
 */
export interface DashboardKpiCardProps {
  title: string;
  value: string;
  changePercent?: number | string | null;
  changePeriod?: string;
  link?: string;
  badgeCount?: number;
  badgePulse?: boolean;
}

function parseChange(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

export function DashboardKpiCard({
  title,
  value,
  changePercent,
  changePeriod,
  link,
  badgeCount,
  badgePulse = false,
}: DashboardKpiCardProps): JSX.Element {
  const change = parseChange(changePercent);
  const isUp = change !== null && change >= 0;

  const body = (
    <div
      className={cn(
        'relative flex flex-col gap-2 rounded-lg border border-gray-200 bg-white p-5',
        link && 'transition-colors duration-75 hover:bg-gray-50',
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-label font-medium uppercase tracking-wider text-gray-500">{title}</span>
        {typeof badgeCount === 'number' && badgeCount > 0 ? (
          <span className="relative inline-flex">
            {badgePulse ? (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/40" />
            ) : null}
            <span className="relative inline-flex items-center rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-fg">
              {badgeCount}
            </span>
          </span>
        ) : null}
      </div>

      <span className="text-[28px] font-semibold leading-none tracking-tight text-gray-900 tabular-nums">
        {value}
      </span>

      {change !== null ? (
        <div className="flex items-center gap-1 text-xs">
          <span className={cn('inline-flex items-center font-medium', isUp ? 'text-green-700' : 'text-red-700')}>
            {isUp ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {Math.abs(change).toFixed(1)}%
          </span>
          {changePeriod ? <span className="text-gray-400">{changePeriod}</span> : null}
        </div>
      ) : null}
    </div>
  );

  if (link) {
    return (
      <Link href={link} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-lg">
        {body}
      </Link>
    );
  }
  return body;
}
