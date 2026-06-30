'use client';

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, ShoppingCart } from 'lucide-react';
import { PageLayout, PageContainer } from '@/components/merchant/PageLayout';
import {
  DataTable,
  DataTableHeader,
  DataTableHeaderCell,
  DataTableBody,
  DataTableRow,
  DataTableCell,
  DataTableEmpty,
} from '@/components/shared/DataTable';
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
import { StatusBadge } from '@/components/shared/StatusBadge';
import { TableRowSkeleton } from '@/components/shared/LoadingSkeleton';
import { SyncStatusBadge } from '@/components/merchant/SyncStatusBadge';
import { useOrders } from '@/hooks/useOrders';
import { useBuyers } from '@/hooks/useBuyers';
import { formatDate, formatMoney } from '@/lib/format';
import type { OrderSummary } from '@/types/api';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'fulfilled', label: 'Fulfilled' },
  { value: 'cancelled', label: 'Cancelled' },
] as const;

const COLUMN_COUNT = 8;

/**
 * Merchant orders list. A filter bar (order-number search, status, buyer, date
 * range) drives a cursor-paginated {@link DataTable}; status / buyer / date are
 * applied server-side, the order-number search is client-side over loaded rows.
 * Each row links to the order detail. Orders are created by buyers — read-only.
 */
function OrdersView(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [buyerId, setBuyerId] = useState(() => searchParams.get('buyerId') ?? 'all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const query = useOrders({
    mode: 'merchant',
    status: status === 'all' ? undefined : status,
    buyerId: buyerId === 'all' ? undefined : buyerId,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });
  const buyers = useBuyers({});

  const rows = useMemo<OrderSummary[]>(
    () => (query.data?.pages ?? []).flatMap((page) => page.data),
    [query.data],
  );
  const buyerOptions = useMemo(
    () => (buyers.data?.pages ?? []).flatMap((page) => page.data),
    [buyers.data],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((o) => (o.shopifyOrderNumber ?? '').toLowerCase().includes(term));
  }, [rows, search]);

  return (
    <PageLayout title="Orders" subtitle="All wholesale orders across your buyers.">
      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
          <Input
            placeholder="Search order #…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-64 pl-9"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-9 w-40">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={buyerId} onValueChange={setBuyerId}>
          <SelectTrigger className="h-9 w-48">
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

      <DataTable>
        <DataTableHeader>
          <tr>
            <DataTableHeaderCell>Order #</DataTableHeaderCell>
            <DataTableHeaderCell>Buyer</DataTableHeaderCell>
            <DataTableHeaderCell>Date</DataTableHeaderCell>
            <DataTableHeaderCell align="right">Items</DataTableHeaderCell>
            <DataTableHeaderCell align="right">Total</DataTableHeaderCell>
            <DataTableHeaderCell>Invoice</DataTableHeaderCell>
            <DataTableHeaderCell>Sync</DataTableHeaderCell>
            <DataTableHeaderCell align="right">Actions</DataTableHeaderCell>
          </tr>
        </DataTableHeader>
        <DataTableBody>
          {query.isLoading ? (
            Array.from({ length: 8 }).map((_, i) => (
              <TableRowSkeleton key={i} columns={[90, 160, 90, 40, 90, 80, 80, 50]} />
            ))
          ) : filtered.length === 0 ? (
            <DataTableEmpty
              colSpan={COLUMN_COUNT}
              icon={<ShoppingCart className="h-6 w-6" />}
              title="No orders match these filters"
              message="Approved buyers can place orders through your wholesale portal."
            />
          ) : (
            filtered.map((order) => (
              <DataTableRow
                key={order.id}
                clickable
                onClick={() => router.push(`/orders/${order.id}`)}
              >
                <DataTableCell className="font-mono text-xs text-text-secondary">
                  {order.shopifyOrderNumber ?? '—'}
                </DataTableCell>
                <DataTableCell>{order.buyerCompanyName ?? '—'}</DataTableCell>
                <DataTableCell className="text-text-secondary">{formatDate(order.createdAt)}</DataTableCell>
                <DataTableCell align="right">{order.itemCount}</DataTableCell>
                <DataTableCell align="right" className="font-mono">{formatMoney(order.total)}</DataTableCell>
                <DataTableCell>
                  {order.invoiceStatus ? (
                    <StatusBadge status={order.invoiceStatus} />
                  ) : (
                    <span className="text-xs text-text-tertiary">Pending</span>
                  )}
                </DataTableCell>
                <DataTableCell>
                  <SyncStatusBadge status={order.syncStatus} />
                </DataTableCell>
                <DataTableCell align="right" onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="sm" onClick={() => router.push(`/orders/${order.id}`)}>
                    View
                  </Button>
                </DataTableCell>
              </DataTableRow>
            ))
          )}
        </DataTableBody>
      </DataTable>

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

export default function OrdersPage(): JSX.Element {
  // useSearchParams requires a Suspense boundary in the App Router.
  return (
    <Suspense
      fallback={
        <PageContainer>
          <DataTable>
            <DataTableBody>
              {Array.from({ length: 8 }).map((_, i) => (
                <TableRowSkeleton key={i} columns={[90, 160, 90, 40, 90, 80, 80, 50]} />
              ))}
            </DataTableBody>
          </DataTable>
        </PageContainer>
      }
    >
      <OrdersView />
    </Suspense>
  );
}
