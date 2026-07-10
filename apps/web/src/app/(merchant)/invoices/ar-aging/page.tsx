'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Download } from 'lucide-react';
import { PageLayout } from '@/components/merchant/PageLayout';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DashboardKpiCard } from '@/components/merchant/DashboardKpiCard';
import { ArAgingChart } from '@/components/merchant/ArAgingChart';
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton';
import { ApiClientError } from '@/lib/api/error';
import { useArAging } from '@/hooks/useMerchantDashboard';
import { useExportArAging } from '@/hooks/useInvoiceActions';
import { formatMoney } from '@/lib/format';
import type { ArAgingReport } from '@/types/api';

const BUCKET_ROWS: Array<{ key: keyof ArAgingReport; label: string; filter: string }> = [
  { key: 'current', label: 'Current (not yet due)', filter: 'current' },
  { key: 'overdue_1_30', label: '1–30 days', filter: '1-30' },
  { key: 'overdue_31_60', label: '31–60 days', filter: '31-60' },
  { key: 'overdue_61_90', label: '61–90 days', filter: '61-90' },
  { key: 'overdue_90_plus', label: '90+ days', filter: '90-plus' },
];

/**
 * AR aging report. Four summary cards, the horizontal aging chart (bars deep-link
 * to the filtered invoice list), a per-bucket breakdown table (rows deep-link
 * too), and a CSV export.
 */
export default function ArAgingPage(): JSX.Element {
  const router = useRouter();
  const query = useArAging();
  const exportCsv = useExportArAging();

  const data = query.data;

  const totals = useMemo(() => {
    if (!data) return { outstanding: 0, current: 0, overdue: 0, overdue90: 0 };
    const amount = (k: keyof ArAgingReport): number => Number(data[k].outstandingAmount);
    const overdue = amount('overdue_1_30') + amount('overdue_31_60') + amount('overdue_61_90') + amount('overdue_90_plus');
    return {
      outstanding: amount('current') + overdue,
      current: amount('current'),
      overdue,
      overdue90: amount('overdue_90_plus'),
    };
  }, [data]);

  const handleExport = (): void => {
    exportCsv.mutate(undefined, {
      onSuccess: () => toast.success('AR aging report exported'),
      onError: (err) => toast.error(err instanceof ApiClientError ? err.message : 'Export failed'),
    });
  };

  return (
    <PageLayout
      title="AR Aging"
      subtitle="Outstanding receivables by age."
      headerActions={
        <Button variant="secondary" size="sm" onClick={handleExport} disabled={exportCsv.isPending}>
          {exportCsv.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Download className="h-4 w-4" />}
          Export CSV
        </Button>
      }
    >
      <nav className="mb-4 text-xs text-text-secondary">
        <Link href="/invoices" className="hover:text-text-primary">
          Invoices
        </Link>
        <span className="px-1.5">/</span>
        <span className="text-text-primary">AR Aging</span>
      </nav>

      {query.isLoading || !data ? (
        <LoadingSkeleton rows={6} columns={[3, 1, 2, 1]} />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <DashboardKpiCard title="Total Outstanding" value={formatMoney(totals.outstanding)} />
            <DashboardKpiCard title="Current (not yet due)" value={formatMoney(totals.current)} />
            <DashboardKpiCard title="Overdue" value={formatMoney(totals.overdue)} />
            <DashboardKpiCard title="Overdue 90+ days" value={formatMoney(totals.overdue90)} />
          </div>

          <section className="panel p-4">
            <h2 className="mb-2 text-label font-medium uppercase tracking-wider text-text-secondary">
              Outstanding by age
            </h2>
            <ArAgingChart data={data} />
          </section>

          <section className="panel">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bucket</TableHead>
                  <TableHead className="text-right"># Invoices</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">% of Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {BUCKET_ROWS.map((row) => {
                  const bucket = data[row.key];
                  const amount = Number(bucket.outstandingAmount);
                  const pct = totals.outstanding > 0 ? (amount / totals.outstanding) * 100 : 0;
                  return (
                    <TableRow
                      key={row.key}
                      clickable
                      className="cursor-pointer"
                      onClick={() => router.push(`/invoices?agingBucket=${row.filter}`)}
                    >
                      <TableCell className="font-medium text-text-primary">{row.label}</TableCell>
                      <TableCell className="text-right tabular-nums">{bucket.invoiceCount}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{formatMoney(amount)}</TableCell>
                      <TableCell className="text-right tabular-nums text-text-secondary">{pct.toFixed(1)}%</TableCell>
                    </TableRow>
                  );
                })}
                <TableRow>
                  <TableCell className="font-semibold text-text-primary">Total</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {BUCKET_ROWS.reduce((acc, r) => acc + data[r.key].invoiceCount, 0)}
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold tabular-nums">
                    {formatMoney(totals.outstanding)}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">100.0%</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </section>
        </div>
      )}
    </PageLayout>
  );
}
