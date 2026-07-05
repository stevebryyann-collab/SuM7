'use client';

import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts';
import { formatDate, formatDateShort } from '@/lib/format';

/**
 * Daily order-count trend (Recharts BarChart). Ocean gradient bars, glass
 * tooltip (CLAUDE.md → Charts). Pairs with {@link GmvTrendChart} on analytics.
 */
const OCEAN = '#0A84FF';
const GRID = '#DCE7F3';
const TICK = '#5A6B7E';

interface OrderDatum {
  date: string;
  orders: number;
}

function OrderTooltip({ active, payload }: TooltipProps<number, string>): JSX.Element | null {
  if (!active || !payload || payload.length === 0) return null;
  const datum = payload[0]?.payload as OrderDatum | undefined;
  if (!datum) return null;
  return (
    <div className="rounded-lg border border-glass-border bg-glass-strong px-3 py-2 text-xs shadow-glass backdrop-blur-glass">
      <p className="font-medium text-text-primary">{formatDate(datum.date)}</p>
      <p className="mt-1 font-medium tabular-nums text-text-primary">
        {datum.orders} order{datum.orders === 1 ? '' : 's'}
      </p>
    </div>
  );
}

export function OrderTrendChart({
  data,
}: {
  data: { date: string; orderCount: number }[];
}): JSX.Element {
  const chartData: OrderDatum[] = data.map((point) => ({ date: point.date, orders: point.orderCount }));
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
          <defs>
            <linearGradient id="orderTrendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3D9BFF" stopOpacity={0.95} />
              <stop offset="100%" stopColor={OCEAN} stopOpacity={0.75} />
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
            allowDecimals={false}
            tick={{ fontSize: 11, fill: TICK }}
            axisLine={false}
            tickLine={false}
            width={32}
          />
          <Tooltip content={<OrderTooltip />} cursor={{ fill: 'rgba(10,132,255,0.06)' }} />
          <Bar dataKey="orders" fill="url(#orderTrendFill)" radius={[8, 8, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
