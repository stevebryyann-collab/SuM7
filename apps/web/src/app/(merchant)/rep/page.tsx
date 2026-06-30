'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, UserCheck } from 'lucide-react';
import { PageLayout } from '@/components/merchant/PageLayout';
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHeader,
  DataTableHeaderCell,
  DataTableRow,
} from '@/components/shared/DataTable';
import { Button, LoadingButton } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TableRowSkeleton } from '@/components/shared/LoadingSkeleton';
import { toast } from '@/components/shared/toasts';
import { formatMoney, formatPaymentTerms, formatRelative } from '@/lib/format';
import { startRepSession } from '@/lib/rep-session';
import { useRepBuyers, useStartRepSession, type RepBuyer } from '@/hooks/useRep';

const COLUMN_COUNT = 8;
const SKELETON_COLS = [120, 160, 80, 70, 120, 90, 60, 150];

export default function SalesRepPortalPage(): JSX.Element {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useRepBuyers(search);
  const startSession = useStartRepSession();

  const buyers = useMemo<RepBuyer[]>(
    () => data?.pages.flatMap((page) => page.buyers) ?? [],
    [data],
  );

  function placeOrderFor(buyer: RepBuyer): void {
    startSession.mutate(buyer.buyerId, {
      onSuccess: (result) => {
        startRepSession(result.sessionToken, result.buyerCompanyName);
        toast.success(`Placing an order for ${result.buyerCompanyName}.`);
        router.push('/portal/catalog');
      },
      onError: () => toast.error('Could not start a session for this buyer.'),
    });
  }

  return (
    <PageLayout
      title="Sales Rep Portal"
      subtitle="Order on behalf of your wholesale buyers."
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by company"
            className="h-9 pl-8"
            aria-label="Search buyers by company name"
          />
        </div>
      </div>

      <DataTable>
        <DataTableHeader>
          <tr>
            <DataTableHeaderCell>Company</DataTableHeaderCell>
            <DataTableHeaderCell>Email</DataTableHeaderCell>
            <DataTableHeaderCell>Tier</DataTableHeaderCell>
            <DataTableHeaderCell>Terms</DataTableHeaderCell>
            <DataTableHeaderCell align="right">Credit Used / Limit</DataTableHeaderCell>
            <DataTableHeaderCell>Last Order</DataTableHeaderCell>
            <DataTableHeaderCell align="right">Total Orders</DataTableHeaderCell>
            <DataTableHeaderCell align="right">Action</DataTableHeaderCell>
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
              title="Couldn't load buyers"
              message="Please refresh to try again."
            />
          ) : buyers.length === 0 ? (
            <DataTableEmpty
              colSpan={COLUMN_COUNT}
              icon={<UserCheck className="h-6 w-6" />}
              title="No approved buyers"
              message="Approved buyers will appear here so you can order on their behalf."
            />
          ) : (
            buyers.map((buyer) => {
              const pending = startSession.isPending && startSession.variables === buyer.buyerId;
              return (
                <DataTableRow key={buyer.buyerId}>
                  <DataTableCell className="font-medium">
                    <Link
                      href={`/rep/buyer/${buyer.buyerId}/orders?company=${encodeURIComponent(buyer.companyName)}`}
                      className="text-accent transition-colors duration-fast hover:underline"
                    >
                      {buyer.companyName}
                    </Link>
                  </DataTableCell>
                  <DataTableCell className="text-text-secondary">{buyer.email}</DataTableCell>
                  <DataTableCell className="text-text-secondary">
                    {buyer.pricingTierName ?? 'Default'}
                  </DataTableCell>
                  <DataTableCell className="text-text-secondary">
                    {formatPaymentTerms(buyer.paymentTerms)}
                  </DataTableCell>
                  <DataTableCell align="right">
                    {formatMoney(buyer.creditUsed)}
                    <span className="text-text-tertiary">
                      {' / '}
                      {buyer.creditLimit ? formatMoney(buyer.creditLimit) : '—'}
                    </span>
                  </DataTableCell>
                  <DataTableCell className="text-text-secondary">
                    {buyer.lastOrderAt ? formatRelative(buyer.lastOrderAt) : 'Never'}
                  </DataTableCell>
                  <DataTableCell align="right">{buyer.totalOrderCount}</DataTableCell>
                  <DataTableCell align="right">
                    <LoadingButton
                      variant="secondary"
                      size="sm"
                      isLoading={pending}
                      onClick={() => placeOrderFor(buyer)}
                    >
                      Place Order for Buyer
                    </LoadingButton>
                  </DataTableCell>
                </DataTableRow>
              );
            })
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
    </PageLayout>
  );
}
