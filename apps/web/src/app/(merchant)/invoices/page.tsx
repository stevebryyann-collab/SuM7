'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { BarChart3 } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
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
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton';
import { useInvoices } from '@/hooks/useInvoices';
import { useArAging } from '@/hooks/useMerchantDashboard';
import { useBuyers } from '@/hooks/useBuyers';
import { formatMoney } from '@/lib/format';
import type { ArAgingReport, InvoiceSummary } from '@/types/api';

type InvoiceTab = 'all' | 'sent' | 'overdue' | 'paid' | 'void';

const TAB_STATUS: Record<InvoiceTab, string | undefined> = {
  all: undefined,
  sent: 'sent',
  overdue: 'overdue',
  paid: 'paid',
  void: 'void',
};

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
 * Merchant invoices + AR. Tabs scope by status; a filter bar adds invoice-number
 * search, buyer, and an invoice-date range; the summary bar shows outstanding and
 * overdue totals (from the AR-aging report). Honours the `agingBucket` query the
 * dashboard chart links to. Pagination is cursor-based.
 */
function InvoicesView(): JSX.Element {
  const searchParams = useSearchParams();
  const agingBucket = searchParams.get('agingBucket') ?? undefined;

  const [tab, setTab] = useState<InvoiceTab>('all');
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

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Receivables and payment status."
        actions={
          <Link href="/invoices/ar-aging">
            <Button variant="default" size="sm">
              <BarChart3 className="h-4 w-4" />
              AR aging report
            </Button>
          </Link>
        }
      />

      <section className="panel">
        <div className="flex flex-col gap-3 border-b border-gray-200 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs value={tab} onValueChange={(v) => setTab(v as InvoiceTab)}>
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="sent">Sent</TabsTrigger>
                <TabsTrigger value="overdue">Overdue</TabsTrigger>
                <TabsTrigger value="paid">Paid</TabsTrigger>
                <TabsTrigger value="void">Void</TabsTrigger>
              </TabsList>
            </Tabs>
            <Input
              placeholder="Search invoice #…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-48"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Select value={buyerId} onValueChange={setBuyerId}>
              <SelectTrigger className="h-8 w-48">
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
                className="h-8 w-36"
              />
              <span className="text-xs text-gray-400">to</span>
              <Input
                type="date"
                aria-label="To date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-8 w-36"
              />
            </div>
          </div>
        </div>

        {/* Summary bar */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-gray-200 bg-gray-50 px-4 py-2.5 text-sm">
          <span className="text-gray-600">
            Showing <span className="font-medium text-gray-900">{filtered.length}{query.hasNextPage ? '+' : ''}</span>{' '}
            invoice{filtered.length === 1 ? '' : 's'}
          </span>
          <span className="text-gray-600">
            Outstanding:{' '}
            <span className="font-medium tabular-nums text-gray-900">
              {formatMoney(totalOutstanding(aging.data))}
            </span>
          </span>
          <span className="text-gray-600">
            Overdue:{' '}
            <span className="font-medium tabular-nums text-red-700">
              {formatMoney(totalOverdue(aging.data))}
            </span>
          </span>
          {agingBucket ? (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
              Aging bucket: {agingBucket}
            </span>
          ) : null}
        </div>

        {query.isLoading ? (
          <LoadingSkeleton rows={10} columns={[2, 3, 2, 2, 1, 1, 1, 2]} />
        ) : (
          <InvoiceTable invoices={filtered} />
        )}

        {query.hasNextPage ? (
          <div className="flex justify-center border-t border-gray-200 py-3">
            <Button
              variant="default"
              size="sm"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? <Spinner className="h-3.5 w-3.5" /> : null}
              Load more
            </Button>
          </div>
        ) : null}
      </section>
    </>
  );
}

export default function InvoicesPage(): JSX.Element {
  return (
    <Suspense fallback={<LoadingSkeleton rows={10} columns={[2, 3, 2, 2, 1, 1, 1, 2]} />}>
      <InvoicesView />
    </Suspense>
  );
}
