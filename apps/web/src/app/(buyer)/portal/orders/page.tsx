'use client';

import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/shared/PageHeader';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { CursorPagination } from '@/components/shared/CursorPagination';
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton';
import { useOrders } from '@/hooks/useOrders';
import { formatDate, formatMoney } from '@/lib/format';
import type { OrderSummary } from '@/types/api';

/** Buyer's own order history (cursor paginated). */
export default function BuyerOrdersPage(): JSX.Element {
  const [pageIndex, setPageIndex] = useState(0);
  const query = useOrders({ mode: 'buyer' });

  const pages = useMemo(() => query.data?.pages ?? [], [query.data?.pages]);
  const orders: OrderSummary[] = useMemo(() => pages[pageIndex]?.data ?? [], [pages, pageIndex]);

  const goNext = (): void => {
    if (pageIndex < pages.length - 1) setPageIndex((i) => i + 1);
    else if (query.hasNextPage) void query.fetchNextPage().then(() => setPageIndex((i) => i + 1));
  };

  return (
    <>
      <PageHeader title="Your Orders" description="Order history and invoice status." />
      <section className="panel">
        {query.isLoading ? (
          <LoadingSkeleton rows={8} columns={[2, 1, 2, 2, 1]} />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order #</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Terms</TableHead>
                  <TableHead>Placed</TableHead>
                  <TableHead>Invoice</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-gray-500">
                      You have no orders yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  orders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-mono text-xs text-gray-700">
                        {order.shopifyOrderNumber ?? '—'}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={order.status} />
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatMoney(order.total)}
                      </TableCell>
                      <TableCell className="uppercase text-gray-600">{order.paymentTerms ?? '—'}</TableCell>
                      <TableCell className="text-gray-600">{formatDate(order.createdAt)}</TableCell>
                      <TableCell>
                        {order.invoiceStatus ? <StatusBadge status={order.invoiceStatus} /> : '—'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            <CursorPagination
              hasPrevious={pageIndex > 0}
              hasNext={pageIndex < pages.length - 1 || query.hasNextPage}
              isLoading={query.isFetchingNextPage}
              onPrevious={() => setPageIndex((i) => Math.max(0, i - 1))}
              onNext={goNext}
            />
          </>
        )}
      </section>
    </>
  );
}
