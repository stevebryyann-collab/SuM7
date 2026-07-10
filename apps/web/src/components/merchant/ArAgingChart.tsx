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
 * Horizontal AR-aging bar chart. Five fixed buckets on the palette's semantic
 * escalation (mint → deep coral). Clicking a bar navigates to the filtered
 * invoice list. Tooltip (glass) shows bucket label, invoice count and amount.
 */
interface AgingDatum {
  key: string;
  label: string;
  amount: number;
  count: number;
  color: string;
  filter: string;
}

const GRID = '#DCE7F3';
const TICK = '#5A6B7E';

const BUCKETS: Array<{ key: keyof ArAgingReport; label: string; color: string; filter: string }> = [
  { key: 'current', label: 'Current', color: '#34C759', filter: 'current' },
  { key: 'overdue_1_30', label: '1–30 days', color: '#FF9F0A', filter: '1-30' },
  { key: 'overdue_31_60', label: '31–60 days', color: '#FF7A1A', filter: '31-60' },
  { key: 'overdue_61_90', label: '61–90 days', color: '#FF453A', filter: '61-90' },
  { key: 'overdue_90_plus', label: '90+ days', color: '#C42B22', filter: '90-plus' },
];

function AgingTooltip({ active, payload }: TooltipProps<number, string>): JSX.Element | null {
  if (!active || !payload || payload.length === 0) return null;
  const datum = payload[0]?.payload as AgingDatum | undefined;
  if (!datum) return null;
  return (
    <div className="rounded-lg border border-glass-border bg-glass-strong px-3 py-2 text-xs shadow-glass backdrop-blur-glass">
      <p className="font-medium text-text-primary">{datum.label}</p>
      <p className="mt-1 text-text-secondary">
        {datum.count} invoice{datum.count === 1 ? '' : 's'}
      </p>
      <p className="font-medium tabular-nums text-text-primary">{formatMoney(datum.amount)}</p>
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
            tick={{ fontSize: 11, fill: TICK }}
            axisLine={{ stroke: GRID }}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={80}
            tick={{ fontSize: 11, fill: TICK }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<AgingTooltip />} cursor={{ fill: 'rgba(10,132,255,0.06)' }} />
          <Bar
            dataKey="amount"
            radius={[0, 8, 8, 0]}
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
