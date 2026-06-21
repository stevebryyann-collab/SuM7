'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/shared/PageHeader';
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
import { Spinner } from '@/components/ui/spinner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton';
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

/**
 * Merchant orders list. Filter bar (order-number search, status, buyer, date
 * range) drives a cursor-paginated table; status / buyer / date are applied
 * server-side, the order-number search is client-side over the loaded rows. Each
 * row links to the order detail. Orders are created by buyers — read-only here.
 */
export default function OrdersPage(): JSX.Element {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [buyerId, setBuyerId] = useState('all');
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
    <>
      <PageHeader title="Orders" description="All wholesale orders across your buyers." />
      <section className="panel">
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 px-4 py-3">
          <Input
            placeholder="Search order #…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-44"
          />
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-8 w-40">
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

        {query.isLoading ? (
          <LoadingSkeleton rows={8} columns={[2, 3, 2, 1, 2, 2, 2, 1]} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order #</TableHead>
                  <TableHead>Buyer</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-right">Subtotal</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Terms</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Sync</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="py-8 text-center text-sm text-gray-500">
                      No orders match these filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((order) => (
                    <TableRow
                      key={order.id}
                      clickable
                      className="cursor-pointer"
                      onClick={() => router.push(`/orders/${order.id}`)}
                    >
                      <TableCell className="font-mono text-xs text-gray-700">
                        {order.shopifyOrderNumber ?? '—'}
                      </TableCell>
                      <TableCell>{order.buyerCompanyName ?? '—'}</TableCell>
                      <TableCell className="text-gray-600">{formatDate(order.createdAt)}</TableCell>
                      <TableCell className="text-right tabular-nums">{order.itemCount}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatMoney(order.subtotal)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatMoney(order.total)}
                      </TableCell>
                      <TableCell className="uppercase text-gray-600">{order.paymentTerms ?? '—'}</TableCell>
                      <TableCell className="text-gray-600">
                        {order.dueDate ? formatDate(order.dueDate) : '—'}
                      </TableCell>
                      <TableCell>
                        {order.invoiceStatus ? <StatusBadge status={order.invoiceStatus} /> : (
                          <span className="text-xs text-gray-400">Pending</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <SyncStatusBadge status={order.syncStatus} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
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
