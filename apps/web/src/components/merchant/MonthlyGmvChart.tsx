'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts';
import type { AnalyticsMonthlyRow } from '@/types/api';
import { formatMoney, formatMoneyCompact, formatMonth } from '@/lib/format';

/**
 * Monthly GMV over the last 12 months as a vertical bar chart. Ocean gradient
 * bars, month labels on the X axis. Consistent axis styling with the other
 * analytics charts: 11px secondary ticks, dashed vertical gridlines only
 * (CLAUDE.md → Charts).
 */
const OCEAN = '#0A84FF';
const GRID = '#DCE7F3';
const TICK = '#5A6B7E';

/** `YYYY-MM` → short month label (`Jun`) for the dense X axis. */
function monthShort(value: string): string {
  const [year, month] = value.split('-').map((part) => Number(part));
  if (!year || !month) return value;
  return new Intl.DateTimeFormat('en-US', { month: 'short' }).format(new Date(year, month - 1, 1));
}

function MonthTooltip({ active, payload }: TooltipProps<number, string>): JSX.Element | null {
  if (!active || !payload || payload.length === 0) return null;
  const datum = payload[0]?.payload as AnalyticsMonthlyRow | undefined;
  if (!datum) return null;
  return (
    <div className="rounded-lg border border-glass-border bg-glass-strong p-2 text-sm shadow-glass backdrop-blur-glass">
      <p className="font-medium text-text-primary">{formatMonth(datum.month)}</p>
      <p className="mt-0.5 tabular-nums text-text-secondary">{formatMoney(datum.gmv)}</p>
    </div>
  );
}

export function MonthlyGmvChart({ data }: { data: AnalyticsMonthlyRow[] }): JSX.Element {
  const chartData = data.map((row) => ({ ...row, value: Number(row.gmv) || 0 }));

  if (chartData.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center text-sm text-text-secondary">
        No monthly data yet.
      </div>
    );
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
          <defs>
            <linearGradient id="monthlyGmvFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3D9BFF" stopOpacity={0.95} />
              <stop offset="100%" stopColor={OCEAN} stopOpacity={0.72} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="4 4" stroke={GRID} horizontal={false} />
          <XAxis
            dataKey="month"
            tickFormatter={monthShort}
            tick={{ fontSize: 11, fill: TICK }}
            axisLine={{ stroke: GRID }}
            tickLine={false}
            interval={0}
          />
          <YAxis
            tickFormatter={(v: number) => formatMoneyCompact(v)}
            tick={{ fontSize: 11, fill: TICK }}
            axisLine={false}
            tickLine={false}
            width={56}
          />
          <Tooltip content={<MonthTooltip />} cursor={{ fill: 'rgba(10,132,255,0.06)' }} />
          <Bar dataKey="value" fill="url(#monthlyGmvFill)" radius={[8, 8, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
