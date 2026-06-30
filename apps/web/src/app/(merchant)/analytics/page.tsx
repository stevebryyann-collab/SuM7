'use client';

import { useMemo, useState } from 'react';
import { subDays, subMonths } from 'date-fns';
import { Download } from 'lucide-react';
import type { AnalyticsExportType } from '@b2b/shared/schemas';
import { PageLayout } from '@/components/merchant/PageLayout';
import { DashboardKpiCard } from '@/components/merchant/DashboardKpiCard';
import { GmvTrendChart } from '@/components/merchant/GmvTrendChart';
import { TopBuyersChart } from '@/components/merchant/TopBuyersChart';
import { MonthlyGmvChart } from '@/components/merchant/MonthlyGmvChart';
import {
  DataTable,
  DataTableHeader,
  DataTableHeaderCell,
  DataTableBody,
  DataTableRow,
  DataTableCell,
  DataTableEmpty,
} from '@/components/shared/DataTable';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { KpiCardSkeleton, ChartSkeleton } from '@/components/shared/LoadingSkeleton';
import { toast } from '@/components/shared/toasts';
import { useAnalytics, useAnalyticsExport } from '@/hooks/useAnalytics';
import { ApiClientError } from '@/lib/api/error';
import { formatMoney, formatDate } from '@/lib/format';
import { cn } from '@/lib/cn';

const PRESETS = [
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '90d', label: '90D' },
  { value: '12m', label: '12M' },
] as const;

type Preset = (typeof PRESETS)[number]['value'];

/** Resolve a preset into an inclusive ISO [from, to] window. */
function resolveRange(preset: Preset): { from: string; to: string } {
  const now = new Date();
  const from =
    preset === '7d'
      ? subDays(now, 6)
      : preset === '90d'
        ? subDays(now, 89)
        : preset === '12m'
          ? subMonths(now, 11)
          : subDays(now, 29);
  return { from: from.toISOString(), to: now.toISOString() };
}

/**
 * Merchant analytics. A header date-range selector (7D/30D/90D/12M) drives one
 * aggregator request: KPI cards, a full-width GMV trend, a Top-10 buyers bar +
 * monthly-GMV bar, and tabbed detail tables (top buyers / per-day order trend).
 * All money is right-aligned tabular monospace; charts share one axis style.
 */
export default function AnalyticsPage(): JSX.Element {
  const [preset, setPreset] = useState<Preset>('30d');
  const range = useMemo(() => resolveRange(preset), [preset]);
  const { data, isLoading, isError } = useAnalytics(range);

  return (
    <PageLayout
      title="Analytics"
      subtitle="GMV, orders, and top buyers over time."
      headerActions={
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5">
            {PRESETS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setPreset(option.value)}
                className={cn(
                  'rounded px-3 py-1 text-sm font-medium transition-colors duration-fast',
                  preset === option.value
                    ? 'bg-accent-subtle text-accent'
                    : 'text-text-secondary hover:bg-neutral-bg',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <ExportMenu />
        </div>
      }
    >
      {isError ? (
        <div className="rounded-lg border border-border bg-surface p-8 text-center text-sm text-danger shadow-sm">
          Analytics failed to load. Refresh to try again.
        </div>
      ) : (
        <>
          {/* Row 1 — KPI cards */}
          {isLoading || !data ? (
            <KpiCardSkeleton />
          ) : (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <DashboardKpiCard title="Total GMV" value={formatMoney(data.kpis.gmv)} />
              <DashboardKpiCard title="Orders Placed" value={String(data.kpis.orders)} />
              <DashboardKpiCard title="Avg Order Value" value={formatMoney(data.kpis.avgOrderValue)} />
              <DashboardKpiCard title="Active Buyers" value={String(data.kpis.activeBuyers)} />
            </div>
          )}

          {/* Row 2 — GMV trend (full width) */}
          <ChartCard title="GMV Trend" period="Daily" className="mt-6">
            {isLoading || !data ? <ChartSkeleton height={200} /> : <GmvTrendChart data={data.trend} />}
          </ChartCard>

          {/* Row 3 — top buyers + monthly GMV */}
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="Top 10 Buyers" period="By GMV">
              {isLoading || !data ? <ChartSkeleton height={288} /> : <TopBuyersChart data={data.topBuyers} />}
            </ChartCard>
            <ChartCard title="Monthly GMV" period="Last 12 months">
              {isLoading || !data ? <ChartSkeleton height={288} /> : <MonthlyGmvChart data={data.monthly} />}
            </ChartCard>
          </div>

          {/* Row 4 — detail tables */}
          <div className="mt-6">
            <Tabs defaultValue="buyers">
              <TabsList>
                <TabsTrigger value="buyers">Top Buyers</TabsTrigger>
                <TabsTrigger value="trend">Order Trend</TabsTrigger>
              </TabsList>
              <TabsContent value="buyers">
                <DataTable>
                  <DataTableHeader>
                    <tr>
                      <DataTableHeaderCell className="w-12">#</DataTableHeaderCell>
                      <DataTableHeaderCell>Company</DataTableHeaderCell>
                      <DataTableHeaderCell align="right">GMV</DataTableHeaderCell>
                      <DataTableHeaderCell align="right">Orders</DataTableHeaderCell>
                      <DataTableHeaderCell align="right">Avg Order</DataTableHeaderCell>
                    </tr>
                  </DataTableHeader>
                  <DataTableBody>
                    {!data || data.topBuyers.length === 0 ? (
                      <DataTableEmpty colSpan={5} title="No buyer activity in this period" />
                    ) : (
                      data.topBuyers.map((buyer, i) => (
                        <DataTableRow key={buyer.buyerId}>
                          <DataTableCell className="text-text-tertiary tabular-nums">{i + 1}</DataTableCell>
                          <DataTableCell className="font-medium">{buyer.companyName}</DataTableCell>
                          <DataTableCell align="right" className="font-mono">{formatMoney(buyer.gmv)}</DataTableCell>
                          <DataTableCell align="right">{buyer.orderCount}</DataTableCell>
                          <DataTableCell align="right" className="font-mono">
                            {formatMoney(buyer.avgOrderValue)}
                          </DataTableCell>
                        </DataTableRow>
                      ))
                    )}
                  </DataTableBody>
                </DataTable>
              </TabsContent>
              <TabsContent value="trend">
                <DataTable>
                  <DataTableHeader>
                    <tr>
                      <DataTableHeaderCell>Date</DataTableHeaderCell>
                      <DataTableHeaderCell align="right">Orders</DataTableHeaderCell>
                      <DataTableHeaderCell align="right">GMV</DataTableHeaderCell>
                    </tr>
                  </DataTableHeader>
                  <DataTableBody>
                    {!data || data.trend.length === 0 ? (
                      <DataTableEmpty colSpan={3} title="No orders in this period" />
                    ) : (
                      [...data.trend].reverse().map((point) => (
                        <DataTableRow key={point.date}>
                          <DataTableCell className="text-text-secondary">{formatDate(point.date)}</DataTableCell>
                          <DataTableCell align="right">{point.orderCount}</DataTableCell>
                          <DataTableCell align="right" className="font-mono">{formatMoney(point.gmv)}</DataTableCell>
                        </DataTableRow>
                      ))
                    )}
                  </DataTableBody>
                </DataTable>
              </TabsContent>
            </Tabs>
          </div>
        </>
      )}
    </PageLayout>
  );
}

function ChartCard({
  title,
  period,
  className,
  children,
}: {
  title: string;
  period: string;
  className?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className={cn('rounded-lg border border-border bg-surface p-5 shadow-sm', className)}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium text-text-primary">{title}</h2>
        <span className="text-xs text-text-secondary">{period}</span>
      </div>
      {children}
    </section>
  );
}

/** Export dropdown: orders / invoices / buyers CSV + an async GDPR export. */
function ExportMenu(): JSX.Element {
  const exporter = useAnalyticsExport();

  const run = (type: AnalyticsExportType): void => {
    exporter.mutate(type, {
      onSuccess: (result) => {
        if (type === 'gdpr' && typeof result !== 'string') {
          toast.success(result.message);
        } else {
          toast.success(`${type[0]!.toUpperCase()}${type.slice(1)} export downloaded`);
        }
      },
      onError: (error) =>
        toast.error(error instanceof ApiClientError ? error.message : 'Export failed'),
    });
  };

  return (
    <DropdownMenu
      label="Export data"
      trigger={
        <span className="inline-flex items-center gap-2">
          <Download className="h-4 w-4" />
          Export
        </span>
      }
      triggerClassName="h-9 w-auto gap-2 border border-border-strong px-3 text-sm font-medium text-text-primary"
    >
      <DropdownMenuItem onSelect={() => run('orders')}>Export orders CSV</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => run('invoices')}>Export invoices CSV</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => run('buyers')}>Export buyers CSV</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => run('gdpr')}>GDPR export (emailed)</DropdownMenuItem>
    </DropdownMenu>
  );
}
