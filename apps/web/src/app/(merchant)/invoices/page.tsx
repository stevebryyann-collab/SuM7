'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { BarChart3, Download, Search } from 'lucide-react';
import { PageLayout, PageContainer } from '@/components/merchant/PageLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { InvoiceTable } from '@/components/merchant/InvoiceTable';
import { InvoiceTableSkeleton } from '@/components/shared/LoadingSkeleton';
import { toast } from '@/components/shared/toasts';
import { useInvoices } from '@/hooks/useInvoices';
import { useArAging } from '@/hooks/useMerchantDashboard';
import { useAnalyticsExport } from '@/hooks/useAnalytics';
import { useBuyers } from '@/hooks/useBuyers';
import { ApiClientError } from '@/lib/api/error';
import { formatMoney, formatRelative } from '@/lib/format';
import type { ArAgingReport, InvoiceSummary } from '@/types/api';

type InvoiceTab = 'all' | 'sent' | 'overdue' | 'paid' | 'void';

const TAB_STATUS: Record<InvoiceTab, string | undefined> = {
  all: undefined,
  sent: 'sent',
  overdue: 'overdue',
  paid: 'paid',
  void: 'void',
};

const VALID_TABS: InvoiceTab[] = ['all', 'sent', 'overdue', 'paid', 'void'];

function initialTab(status: string | null): InvoiceTab {
  return status && (VALID_TABS as string[]).includes(status) ? (status as InvoiceTab) : 'all';
}

function totalOutstanding(aging: ArAgingReport | undefined): number {
  if (!aging) return 0;
  return (
    Number(aging.current.outstandingAmount) +
    Number(aging.overdue_1_30.outstandingAmount) +
    Number(aging.overdue_31_60.outstandingAmount) +
    Number(aging.overdue_61_90.outstandingAmount) +
    Number(aging.overdue_90_plus.outstandingAmount)
  );
}

function totalOverdue(aging: ArAgingReport | undefined): number {
  if (!aging) return 0;
  return (
    Number(aging.overdue_1_30.outstandingAmount) +
    Number(aging.overdue_31_60.outstandingAmount) +
    Number(aging.overdue_61_90.outstandingAmount) +
    Number(aging.overdue_90_plus.outstandingAmount)
  );
}

/**
 * Merchant invoices + AR. Tabs scope by status (also settable via the `status`
 * query the dashboard links use); a filter bar adds invoice-number search, buyer,
 * and an invoice-date range; the summary bar shows outstanding + overdue totals
 * (from the AR-aging report). Honours the `agingBucket` query the dashboard chart
 * links to. Pagination is cursor-based.
 */
function InvoicesView(): JSX.Element {
  const searchParams = useSearchParams();
  const agingBucket = searchParams.get('agingBucket') ?? undefined;

  const [tab, setTab] = useState<InvoiceTab>(() => initialTab(searchParams.get('status')));
  const [search, setSearch] = useState('');
  const [buyerId, setBuyerId] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const query = useInvoices({
    mode: 'merchant',
    status: TAB_STATUS[tab],
    agingBucket,
    buyerId: buyerId === 'all' ? undefined : buyerId,
  });
  const aging = useArAging();
  const buyers = useBuyers({});
  const exporter = useAnalyticsExport();

  const rows = useMemo<InvoiceSummary[]>(
    () => (query.data?.pages ?? []).flatMap((page) => page.data),
    [query.data],
  );
  const buyerOptions = useMemo(
    () => (buyers.data?.pages ?? []).flatMap((page) => page.data),
    [buyers.data],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((inv) => {
      if (term && !inv.invoiceNumber.toLowerCase().includes(term)) return false;
      const invDate = inv.issuedAt ?? inv.createdAt;
      if (dateFrom && invDate < dateFrom) return false;
      if (dateTo && invDate > `${dateTo}T23:59:59.999Z`) return false;
      return true;
    });
  }, [rows, search, dateFrom, dateTo]);

  const downloadReport = (): void => {
    exporter.mutate('invoices', {
      onSuccess: () => toast.success('Invoice report downloaded'),
      onError: (error) =>
        toast.error(error instanceof ApiClientError ? error.message : 'Export failed'),
    });
  };

  const overdueAmount = totalOverdue(aging.data);

  return (
    <PageLayout
      title="Invoices"
      subtitle="Receivables and payment status."
      headerActions={
        <>
          <Button variant="secondary" size="sm" asChild>
            <Link href="/invoices/ar-aging">
              <BarChart3 className="h-4 w-4" />
              AR aging report
            </Link>
          </Button>
          <Button variant="secondary" size="sm" disabled={exporter.isPending} onClick={downloadReport}>
            {exporter.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Download className="h-4 w-4" />}
            Download Report
          </Button>
        </>
      }
    >
      {/* Tabs + search */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as InvoiceTab)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="sent">Sent</TabsTrigger>
            <TabsTrigger value="overdue">Overdue</TabsTrigger>
            <TabsTrigger value="paid">Paid</TabsTrigger>
            <TabsTrigger value="void">Void</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
            <Input
              placeholder="Search invoice #…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-52 pl-9"
            />
          </div>
          <Select value={buyerId} onValueChange={setBuyerId}>
            <SelectTrigger className="h-9 w-44">
              <SelectValue placeholder="All buyers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All buyers</SelectItem>
              {buyerOptions.map((buyer) => (
                <SelectItem key={buyer.buyerId} value={buyer.buyerId}>
                  {buyer.companyName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              aria-label="From date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-9 w-36"
            />
            <span className="text-xs text-text-tertiary">to</span>
            <Input
              type="date"
              aria-label="To date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-9 w-36"
            />
          </div>
        </div>
      </div>

      {/* Summary bar */}
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg bg-neutral-bg px-4 py-3 text-sm">
        <span className="text-text-secondary">
          Showing <span className="font-medium text-text-primary">{filtered.length}{query.hasNextPage ? '+' : ''}</span>{' '}
          invoice{filtered.length === 1 ? '' : 's'}
        </span>
        <span className="text-text-secondary">
          Outstanding:{' '}
          <span className="font-medium tabular-nums text-text-primary">
            {formatMoney(totalOutstanding(aging.data))}
          </span>
        </span>
        <span className="text-text-secondary">
          Overdue:{' '}
          <span className={`font-medium tabular-nums ${overdueAmount > 0 ? 'text-danger' : 'text-text-primary'}`}>
            {formatMoney(overdueAmount)}
          </span>
        </span>
        {agingBucket ? (
          <span className="rounded-full border border-accent-border bg-accent-subtle px-2 py-0.5 text-xs font-medium text-accent">
            Aging bucket: {agingBucket}
          </span>
        ) : null}
        {query.dataUpdatedAt > 0 ? (
          <span className="ml-auto text-2xs text-text-tertiary">
            Updated {formatRelative(new Date(query.dataUpdatedAt))}
          </span>
        ) : null}
      </div>

      {query.isLoading ? <InvoiceTableSkeleton rows={10} /> : <InvoiceTable invoices={filtered} />}

      {query.hasNextPage ? (
        <div className="mt-4 flex justify-center">
          <Button
            variant="secondary"
            size="sm"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? <Spinner className="h-3.5 w-3.5" /> : null}
            Load more
          </Button>
        </div>
      ) : null}
    </PageLayout>
  );
}

export default function InvoicesPage(): JSX.Element {
  return (
    <Suspense
      fallback={
        <PageContainer>
          <InvoiceTableSkeleton rows={10} />
        </PageContainer>
      }
    >
      <InvoicesView />
    </Suspense>
  );
}
