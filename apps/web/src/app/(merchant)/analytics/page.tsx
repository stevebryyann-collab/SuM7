'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { subDays, subMonths } from 'date-fns';
import { ChevronDown, ChevronUp, Download } from 'lucide-react';
import type { AnalyticsExportType } from '@b2b/shared/schemas';
import { PageHeader } from '@/components/shared/PageHeader';
import { DashboardKpiCard } from '@/components/merchant/DashboardKpiCard';
import { GmvTrendChart } from '@/components/merchant/GmvTrendChart';
import { OrderTrendChart } from '@/components/merchant/OrderTrendChart';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton';
import { useAnalytics, useAnalyticsExport } from '@/hooks/useAnalytics';
import { ApiClientError } from '@/lib/api/error';
import { formatMoney, formatMonth } from '@/lib/format';
import { cn } from '@/lib/cn';

type Preset = '7d' | '30d' | '90d' | '12m' | 'custom';

const PRESETS: { value: Preset; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '12m', label: '12 months' },
  { value: 'custom', label: 'Custom' },
];

/** Resolve a preset (or custom inputs) into an inclusive ISO [from, to] window. */
function resolveRange(preset: Preset, customFrom: string, customTo: string): { from: string; to: string } {
  const now = new Date();
  if (preset === 'custom') {
    const from = customFrom ? new Date(`${customFrom}T00:00:00`) : subDays(now, 29);
    const to = customTo ? new Date(`${customTo}T23:59:59`) : now;
    return { from: from.toISOString(), to: to.toISOString() };
  }
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

export default function AnalyticsPage(): JSX.Element {
  const [preset, setPreset] = useState<Preset>('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const range = useMemo(
    () => resolveRange(preset, customFrom, customTo),
    [preset, customFrom, customTo],
  );
  const { data, isLoading, isError } = useAnalytics(range);

  return (
    <>
      <PageHeader
        title="Analytics"
        description="GMV, orders, and top buyers over time."
        actions={<ExportMenu />}
      />

      {/* Date range selector */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white p-0.5 shadow-sm">
          {PRESETS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setPreset(option.value)}
              className={cn(
                'rounded px-3 py-1 text-sm font-medium transition-colors duration-75',
                preset === option.value ? 'bg-accent text-accent-fg' : 'text-gray-600 hover:bg-gray-100',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        {preset === 'custom' ? (
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="h-8 w-40"
              aria-label="From date"
            />
            <span className="text-sm text-gray-400">to</span>
            <Input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="h-8 w-40"
              aria-label="To date"
            />
          </div>
        ) : null}
      </div>

      {isError ? (
        <div className="panel p-8 text-center text-sm text-red-700">
          Analytics failed to load. Refresh to try again.
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {isLoading || !data ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-lg border border-gray-200 bg-white p-5">
                  <LoadingSkeleton rows={2} columns={[2]} />
                </div>
              ))
            ) : (
              <>
                <DashboardKpiCard title="GMV" value={formatMoney(data.kpis.gmv)} />
                <DashboardKpiCard title="Orders" value={String(data.kpis.orders)} />
                <DashboardKpiCard title="Avg Order Value" value={formatMoney(data.kpis.avgOrderValue)} />
                <DashboardKpiCard title="Active Buyers" value={String(data.kpis.activeBuyers)} />
              </>
            )}
          </div>

          {/* Trend charts */}
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section className="panel p-5">
              <h2 className="mb-4 text-label uppercase tracking-wider text-gray-500">GMV Trend</h2>
              {isLoading || !data ? <LoadingSkeleton rows={6} columns={[1]} /> : <GmvTrendChart data={data.trend} />}
            </section>
            <section className="panel p-5">
              <h2 className="mb-4 text-label uppercase tracking-wider text-gray-500">Order Count</h2>
              {isLoading || !data ? <LoadingSkeleton rows={6} columns={[1]} /> : <OrderTrendChart data={data.trend} />}
            </section>
          </div>

          {/* Top buyers */}
          <section className="panel mt-6">
            <div className="border-b border-gray-200 px-4 py-3">
              <h2 className="text-label uppercase tracking-wider text-gray-500">Top 10 Buyers</h2>
            </div>
            {isLoading || !data ? (
              <LoadingSkeleton rows={6} columns={[1, 3, 2, 1, 2]} />
            ) : data.topBuyers.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-500">No buyer activity in this period.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead className="text-right">GMV</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                    <TableHead className="text-right">Avg Order</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.topBuyers.map((buyer, i) => (
                    <TableRow key={buyer.buyerId} className="hover:bg-blue-50">
                      <TableCell className="text-gray-500 tabular-nums">{i + 1}</TableCell>
                      <TableCell>
                        <Link href="/buyers" className="font-medium text-gray-900 hover:text-accent hover:underline">
                          {buyer.companyName}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{formatMoney(buyer.gmv)}</TableCell>
                      <TableCell className="text-right tabular-nums">{buyer.orderCount}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{formatMoney(buyer.avgOrderValue)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>

          {/* Monthly GMV */}
          <section className="panel mt-6">
            <div className="border-b border-gray-200 px-4 py-3">
              <h2 className="text-label uppercase tracking-wider text-gray-500">Monthly GMV (last 12 months)</h2>
            </div>
            {isLoading || !data ? (
              <LoadingSkeleton rows={6} columns={[2, 2, 1, 2, 1]} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">GMV</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                    <TableHead className="text-right">Avg Order</TableHead>
                    <TableHead className="text-right">YoY</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.monthly.map((row) => (
                    <TableRow key={row.month}>
                      <TableCell className="text-gray-700">{formatMonth(row.month)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{formatMoney(row.gmv)}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.orders}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{formatMoney(row.avgOrder)}</TableCell>
                      <TableCell className="text-right">
                        <YoyCell value={row.yoyChangePct} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        </>
      )}
    </>
  );
}

function YoyCell({ value }: { value: string | null }): JSX.Element {
  if (value === null) return <span className="text-gray-400">—</span>;
  const num = Number(value);
  const up = num >= 0;
  return (
    <span className={cn('inline-flex items-center justify-end font-medium tabular-nums', up ? 'text-green-700' : 'text-red-700')}>
      {up ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      {Math.abs(num).toFixed(1)}%
    </span>
  );
}

/** Export dropdown: orders / invoices / buyers CSV + an async GDPR export. */
function ExportMenu(): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const exporter = useAnalyticsExport();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const run = (type: AnalyticsExportType): void => {
    setOpen(false);
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
    <div className="relative" ref={ref}>
      <Button variant="default" size="sm" onClick={() => setOpen((v) => !v)} disabled={exporter.isPending}>
        <Download className="h-4 w-4" />
        Export data
        <ChevronDown className="h-4 w-4 text-gray-500" />
      </Button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 w-56 overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm"
        >
          <MenuButton onClick={() => run('orders')}>Export orders CSV</MenuButton>
          <MenuButton onClick={() => run('invoices')}>Export invoices CSV</MenuButton>
          <MenuButton onClick={() => run('buyers')}>Export buyers CSV</MenuButton>
          <div className="border-t border-gray-200">
            <MenuButton onClick={() => run('gdpr')}>GDPR export (emailed)</MenuButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MenuButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }): JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
    >
      {children}
    </button>
  );
}
