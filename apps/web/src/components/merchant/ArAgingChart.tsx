'use client';

import { useRouter } from 'next/navigation';
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts';
import type { ArAgingReport } from '@/types/api';
import { formatMoney, formatMoneyCompact } from '@/lib/format';

/**
 * Horizontal AR-aging bar chart. Five fixed buckets with solid, semantically
 * escalating colors (green → dark red). Clicking a bar navigates to the filtered
 * invoice list. Tooltip shows bucket label, invoice count and outstanding amount.
 */
interface AgingDatum {
  key: string;
  label: string;
  amount: number;
  count: number;
  color: string;
  filter: string;
}

const BUCKETS: Array<{ key: keyof ArAgingReport; label: string; color: string; filter: string }> = [
  { key: 'current', label: 'Current', color: '#16a34a', filter: 'current' },
  { key: 'overdue_1_30', label: '1–30 days', color: '#ca8a04', filter: '1-30' },
  { key: 'overdue_31_60', label: '31–60 days', color: '#ea580c', filter: '31-60' },
  { key: 'overdue_61_90', label: '61–90 days', color: '#dc2626', filter: '61-90' },
  { key: 'overdue_90_plus', label: '90+ days', color: '#991b1b', filter: '90-plus' },
];

function AgingTooltip({ active, payload }: TooltipProps<number, string>): JSX.Element | null {
  if (!active || !payload || payload.length === 0) return null;
  const datum = payload[0]?.payload as AgingDatum | undefined;
  if (!datum) return null;
  return (
    <div className="rounded-md border border-gray-200 bg-white px-3 py-2 text-xs shadow-sm">
      <p className="font-medium text-gray-900">{datum.label}</p>
      <p className="mt-1 text-gray-500">
        {datum.count} invoice{datum.count === 1 ? '' : 's'}
      </p>
      <p className="font-medium tabular-nums text-gray-900">{formatMoney(datum.amount)}</p>
    </div>
  );
}

export function ArAgingChart({ data }: { data: ArAgingReport }): JSX.Element {
  const router = useRouter();

  const chartData: AgingDatum[] = BUCKETS.map((bucket) => {
    const value = data[bucket.key];
    return {
      key: bucket.key,
      label: bucket.label,
      amount: Number(value.outstandingAmount) || 0,
      count: value.invoiceCount,
      color: bucket.color,
      filter: bucket.filter,
    };
  });

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          layout="vertical"
          data={chartData}
          margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
          barCategoryGap={8}
        >
          <XAxis
            type="number"
            tickFormatter={(v: number) => formatMoneyCompact(v)}
            tick={{ fontSize: 11, fill: '#6b7280' }}
            axisLine={{ stroke: '#e5e7eb' }}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={80}
            tick={{ fontSize: 11, fill: '#374151' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<AgingTooltip />} cursor={{ fill: '#f3f4f6' }} />
          <Bar
            dataKey="amount"
            radius={[0, 2, 2, 0]}
            cursor="pointer"
            onClick={(entry: AgingDatum) => router.push(`/invoices?agingBucket=${entry.filter}`)}
          >
            {chartData.map((entry) => (
              <Cell key={entry.key} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
