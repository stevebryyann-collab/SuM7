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
import type { AnalyticsTopBuyer } from '@/types/api';
import { formatMoney, formatMoneyCompact } from '@/lib/format';

/**
 * Top-10 buyers by GMV as a horizontal bar chart — far more scannable than a
 * table for ranking. Ocean gradient bars. Company names sit on the Y axis; GMV
 * on the X axis. Consistent axis styling with the other analytics charts: 11px
 * secondary ticks, dashed vertical gridlines only (CLAUDE.md → Charts).
 */
const OCEAN = '#0A84FF';
const GRID = '#DCE7F3';
const TICK = '#5A6B7E';

function truncate(value: string, max = 18): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function TopBuyerTooltip({ active, payload }: TooltipProps<number, string>): JSX.Element | null {
  if (!active || !payload || payload.length === 0) return null;
  const datum = payload[0]?.payload as AnalyticsTopBuyer | undefined;
  if (!datum) return null;
  return (
    <div className="rounded-lg border border-glass-border bg-glass-strong p-2 text-sm shadow-glass backdrop-blur-glass">
      <p className="font-medium text-text-primary">{datum.companyName}</p>
      <p className="mt-0.5 tabular-nums text-text-secondary">{formatMoney(datum.gmv)}</p>
    </div>
  );
}

export function TopBuyersChart({ data }: { data: AnalyticsTopBuyer[] }): JSX.Element {
  const chartData = data.slice(0, 10).map((buyer) => ({ ...buyer, value: Number(buyer.gmv) || 0 }));

  if (chartData.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center text-sm text-text-secondary">
        No buyer activity in this period.
      </div>
    );
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          layout="vertical"
          data={chartData}
          margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
          barCategoryGap={6}
        >
          <defs>
            <linearGradient id="topBuyersFill" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={OCEAN} stopOpacity={0.72} />
              <stop offset="100%" stopColor="#3D9BFF" stopOpacity={0.95} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="4 4" stroke={GRID} horizontal={false} />
          <XAxis
            type="number"
            tickFormatter={(v: number) => formatMoneyCompact(v)}
            tick={{ fontSize: 11, fill: TICK }}
            axisLine={{ stroke: GRID }}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="companyName"
            width={130}
            tickFormatter={(v: string) => truncate(v)}
            tick={{ fontSize: 11, fill: TICK }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<TopBuyerTooltip />} cursor={{ fill: 'rgba(10,132,255,0.06)' }} />
          <Bar dataKey="value" fill="url(#topBuyersFill)" radius={[0, 8, 8, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
