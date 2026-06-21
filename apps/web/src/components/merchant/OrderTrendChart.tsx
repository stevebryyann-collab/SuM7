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
 * Daily order-count trend (Recharts BarChart). Single accent fill, flat — no
 * gradients. Pairs with {@link GmvTrendChart} on the analytics page.
 */
const ACCENT = '#2563eb';

interface OrderDatum {
  date: string;
  orders: number;
}

function OrderTooltip({ active, payload }: TooltipProps<number, string>): JSX.Element | null {
  if (!active || !payload || payload.length === 0) return null;
  const datum = payload[0]?.payload as OrderDatum | undefined;
  if (!datum) return null;
  return (
    <div className="rounded-md border border-gray-200 bg-white px-3 py-2 text-xs shadow-sm">
      <p className="font-medium text-gray-900">{formatDate(datum.date)}</p>
      <p className="mt-1 font-medium tabular-nums text-gray-900">
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
          <XAxis
            dataKey="date"
            tickFormatter={(v: string) => formatDateShort(v)}
            tick={{ fontSize: 11, fill: '#6b7280' }}
            axisLine={{ stroke: '#e5e7eb' }}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11, fill: '#6b7280' }}
            axisLine={false}
            tickLine={false}
            width={32}
          />
          <Tooltip content={<OrderTooltip />} cursor={{ fill: '#f3f4f6' }} />
          <Bar dataKey="orders" fill={ACCENT} radius={[2, 2, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
