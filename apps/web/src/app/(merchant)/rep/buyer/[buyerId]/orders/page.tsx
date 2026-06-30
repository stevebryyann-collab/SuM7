'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { PageContainer } from '@/components/merchant/PageLayout';
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHeader,
  DataTableHeaderCell,
  DataTableRow,
} from '@/components/shared/DataTable';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { SyncStatusBadge } from '@/components/merchant/SyncStatusBadge';
import { Button } from '@/components/ui/button';
import { TableRowSkeleton } from '@/components/shared/LoadingSkeleton';
import { formatDate, formatMoney } from '@/lib/format';
import { useRepBuyerOrders, type RepBuyerOrder } from '@/hooks/useRep';

const COLUMN_COUNT = 6;
const SKELETON_COLS = [120, 110, 60, 90, 100, 100];

export default function RepBuyerOrdersPage(): JSX.Element {
  const params = useParams<{ buyerId: string }>();
  const searchParams = useSearchParams();
  const buyerId = params.buyerId;
  const companyName = searchParams.get('company') ?? 'Buyer';

  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useRepBuyerOrders(buyerId);

  const orders = useMemo<RepBuyerOrder[]>(
    () => data?.pages.flatMap((page) => page.orders) ?? [],
    [data],
  );

  return (
    <PageContainer>
      <nav className="mb-2 flex items-center gap-1 text-xs text-text-secondary" aria-label="Breadcrumb">
        <Link href="/rep" className="transition-colors duration-fast hover:text-text-primary">
          Sales Rep
        </Link>
        <ChevronRight className="h-3 w-3 text-text-tertiary" />
        <span className="text-text-primary">{companyName}</span>
        <ChevronRight className="h-3 w-3 text-text-tertiary" />
        <span>Order History</span>
      </nav>
      <h1 className="mb-6 text-2xl font-semibold text-text-primary">Order History</h1>

      <DataTable>
        <DataTableHeader>
          <tr>
            <DataTableHeaderCell>Order #</DataTableHeaderCell>
            <DataTableHeaderCell>Date</DataTableHeaderCell>
            <DataTableHeaderCell align="right">Items</DataTableHeaderCell>
            <DataTableHeaderCell align="right">Total</DataTableHeaderCell>
            <DataTableHeaderCell>Invoice</DataTableHeaderCell>
            <DataTableHeaderCell>Sync</DataTableHeaderCell>
          </tr>
        </DataTableHeader>
        <DataTableBody>
          {isLoading ? (
            <>
              {Array.from({ length: 6 }).map((_, index) => (
                <TableRowSkeleton key={index} columns={SKELETON_COLS} />
              ))}
            </>
          ) : isError ? (
            <DataTableEmpty
              colSpan={COLUMN_COUNT}
              title="Couldn't load orders"
              message="Please refresh to try again."
            />
          ) : orders.length === 0 ? (
            <DataTableEmpty
              colSpan={COLUMN_COUNT}
              title="No orders yet"
              message="This buyer has not placed any orders with you."
            />
          ) : (
            orders.map((order) => (
              <DataTableRow key={order.id}>
                <DataTableCell className="font-medium text-text-primary">
                  {order.shopifyOrderNumber ?? '—'}
                </DataTableCell>
                <DataTableCell className="text-text-secondary">
                  {formatDate(order.createdAt)}
                </DataTableCell>
                <DataTableCell align="right">{order.itemCount}</DataTableCell>
                <DataTableCell align="right" className="font-mono">
                  {formatMoney(order.total)}
                </DataTableCell>
                <DataTableCell>
                  {order.invoiceStatus ? (
                    <StatusBadge status={order.invoiceStatus} variant="invoice" />
                  ) : (
                    <span className="text-xs text-text-tertiary">No invoice</span>
                  )}
                </DataTableCell>
                <DataTableCell>
                  <SyncStatusBadge status={order.syncStatus} />
                </DataTableCell>
              </DataTableRow>
            ))
          )}
        </DataTableBody>
      </DataTable>

      {hasNextPage ? (
        <div className="mt-4 flex justify-center">
          <Button
            variant="secondary"
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}
    </PageContainer>
  );
}
