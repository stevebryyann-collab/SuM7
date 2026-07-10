'use client';

import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts';
import type { GmvTrendPoint } from '@/types/api';
import { formatDate, formatDateShort, formatMoney, formatMoneyCompact } from '@/lib/format';

/**
 * 30-day GMV trend. An Ocean-blue line (2.5px) over a soft top-down ocean
 * gradient fill — the Apple-Health chart feel (CLAUDE.md → Charts). The
 * month-to-date total is shown beneath the chart.
 */
const OCEAN = '#0A84FF';
const GRID = '#DCE7F3';
const TICK = '#5A6B7E';

interface TrendDatum {
  date: string;
  gmv: number;
}

function TrendTooltip({ active, payload }: TooltipProps<number, string>): JSX.Element | null {
  if (!active || !payload || payload.length === 0) return null;
  const datum = payload[0]?.payload as TrendDatum | undefined;
  if (!datum) return null;
  return (
    <div className="rounded-lg border border-glass-border bg-glass-strong px-3 py-2 text-xs shadow-glass backdrop-blur-glass">
      <p className="font-medium text-text-primary">{formatDate(datum.date)}</p>
      <p className="mt-1 font-medium tabular-nums text-text-primary">{formatMoney(datum.gmv)}</p>
    </div>
  );
}

export function GmvTrendChart({ data }: { data: GmvTrendPoint[] }): JSX.Element {
  const chartData: TrendDatum[] = data.map((point) => ({
    date: point.date,
    gmv: Number(point.gmv) || 0,
  }));
  const monthToDate = chartData.reduce((sum, point) => sum + point.gmv, 0);

  return (
    <div>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
            <defs>
              <linearGradient id="gmvTrendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={OCEAN} stopOpacity={0.32} />
                <stop offset="100%" stopColor={OCEAN} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              tickFormatter={(v: string) => formatDateShort(v)}
              tick={{ fontSize: 11, fill: TICK }}
              axisLine={{ stroke: GRID }}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              tickFormatter={(v: number) => formatMoneyCompact(v)}
              tick={{ fontSize: 11, fill: TICK }}
              axisLine={false}
              tickLine={false}
              width={56}
            />
            <Tooltip content={<TrendTooltip />} cursor={{ stroke: OCEAN, strokeWidth: 1, strokeOpacity: 0.4 }} />
            <Area
              type="monotone"
              dataKey="gmv"
              stroke={OCEAN}
              strokeWidth={2.5}
              fill="url(#gmvTrendFill)"
              fillOpacity={1}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex items-baseline gap-2 px-2">
        <span className="text-label uppercase tracking-wider text-text-secondary">Month to date</span>
        <span className="text-sm font-semibold tabular-nums text-text-primary">{formatMoney(monthToDate)}</span>
      </div>
    </div>
  );
}
