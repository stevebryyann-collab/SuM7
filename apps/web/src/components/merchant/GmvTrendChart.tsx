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
 * 30-day GMV trend. A single accent-colored line (2px) over a flat 8%-opacity
 * accent fill — explicitly a flat fill, NOT a gradient (gradients are forbidden).
 * The month-to-date total is shown beneath the chart.
 */
const ACCENT = '#2563eb';

interface TrendDatum {
  date: string;
  gmv: number;
}

function TrendTooltip({ active, payload }: TooltipProps<number, string>): JSX.Element | null {
  if (!active || !payload || payload.length === 0) return null;
  const datum = payload[0]?.payload as TrendDatum | undefined;
  if (!datum) return null;
  return (
    <div className="rounded-md border border-gray-200 bg-white px-3 py-2 text-xs shadow-sm">
      <p className="font-medium text-gray-900">{formatDate(datum.date)}</p>
      <p className="mt-1 font-medium tabular-nums text-gray-900">{formatMoney(datum.gmv)}</p>
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
            <XAxis
              dataKey="date"
              tickFormatter={(v: string) => formatDateShort(v)}
              tick={{ fontSize: 11, fill: '#6b7280' }}
              axisLine={{ stroke: '#e5e7eb' }}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              tickFormatter={(v: number) => formatMoneyCompact(v)}
              tick={{ fontSize: 11, fill: '#6b7280' }}
              axisLine={false}
              tickLine={false}
              width={56}
            />
            <Tooltip content={<TrendTooltip />} cursor={{ stroke: '#d1d5db', strokeWidth: 1 }} />
            <Area
              type="monotone"
              dataKey="gmv"
              stroke={ACCENT}
              strokeWidth={2}
              fill={ACCENT}
              fillOpacity={0.08}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex items-baseline gap-2 px-2">
        <span className="text-label uppercase tracking-wider text-gray-500">Month to date</span>
        <span className="text-sm font-semibold tabular-nums text-gray-900">{formatMoney(monthToDate)}</span>
      </div>
    </div>
  );
}
