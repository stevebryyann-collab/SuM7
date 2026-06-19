'use client';

import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton';
import { BulkOrderTable } from '@/components/buyer/BulkOrderTable';
import { useBuyerCatalog } from '@/hooks/useBuyerCatalog';
import { useBuyerMerchantId } from '@/components/providers/BuyerProviders';
import type { CatalogProduct } from '@/types/api';

/**
 * Buyer catalog + spreadsheet ordering. Loads the tier-priced catalog (infinite
 * cursor pagination) and feeds it into the virtualized {@link BulkOrderTable}.
 * A `stale` flag from any page surfaces a soft "prices updating" badge.
 */
export default function CatalogPage(): JSX.Element {
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const merchantId = useBuyerMerchantId();
  const query = useBuyerCatalog(submittedSearch);

  const products = useMemo<CatalogProduct[]>(
    () => (query.data?.pages ?? []).flatMap((page) => page.products),
    [query.data],
  );
  const isStale = (query.data?.pages ?? []).some((page) => page.stale);

  return (
    <>
      <PageHeader
        title="Catalog"
        description="Enter quantities to build a bulk order. Prices reflect your negotiated tier."
        actions={isStale ? <StatusBadge status="processing" label="Prices updating" /> : undefined}
      />

      <form
        className="mb-4 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmittedSearch(search);
        }}
      >
        <Input
          placeholder="Search products…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 w-72"
        />
        <Button type="submit" variant="default">
          Search
        </Button>
      </form>

      {query.isLoading ? (
        <div className="panel p-4">
          <LoadingSkeleton rows={10} columns={[3, 1, 1, 1, 1]} />
        </div>
      ) : query.isError ? (
        <div className="panel p-6 text-sm text-red-700">Failed to load the catalog. Please refresh.</div>
      ) : merchantId === null ? (
        <div className="panel p-6 text-sm text-gray-600">
          Unable to resolve your merchant context. Please return to the store and re-open the portal.
        </div>
      ) : (
        <>
          <BulkOrderTable products={products} merchantId={merchantId} />
          {query.hasNextPage ? (
            <div className="mt-4 flex justify-center">
              <Button
                variant="default"
                disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                {query.isFetchingNextPage ? <Spinner className="h-3.5 w-3.5" /> : null}
                Load more products
              </Button>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
