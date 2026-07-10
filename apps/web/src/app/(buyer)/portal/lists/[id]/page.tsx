'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { notFound, useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ListPlus, ShoppingCart } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
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
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton';
import { toast } from '@/components/shared/toasts';
import { useShoppingListItems, useShoppingLists } from '@/hooks/useShoppingLists';
import { ApiClientError } from '@/lib/api/error';
import { stageCartSeed } from '@/lib/cart-seed';

/** One saved list — its lines, plus a one-click "load into cart" that seeds the catalog. */
export default function SavedListDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? null;
  const router = useRouter();

  const itemsQuery = useShoppingListItems(id);
  const listsQuery = useShoppingLists();
  const listName = useMemo(
    () => listsQuery.data?.find((list) => list.id === id)?.name ?? 'Saved list',
    [listsQuery.data, id],
  );

  if (itemsQuery.error instanceof ApiClientError && itemsQuery.error.statusCode === 404) {
    notFound();
  }

  const items = itemsQuery.data ?? [];
  const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0);

  const loadIntoCart = (): void => {
    const seed: Record<string, number> = {};
    for (const item of items) {
      if (item.quantity > 0) seed[item.shopifyVariantId] = item.quantity;
    }
    if (!stageCartSeed(seed)) {
      toast.error('This list has no items to load.');
      return;
    }
    toast.success('Loading list into your cart…');
    router.push('/portal/catalog');
  };

  return (
    <>
      <Link
        href="/portal/lists"
        className="mb-4 inline-flex items-center gap-1 text-sm text-accent hover:underline"
      >
        <ArrowLeft className="h-4 w-4" /> Back to saved lists
      </Link>

      <PageHeader
        title={listName}
        description={
          itemsQuery.isLoading
            ? 'Loading…'
            : `${items.length} product${items.length === 1 ? '' : 's'} · ${totalUnits} unit${totalUnits === 1 ? '' : 's'}`
        }
        actions={
          <Button variant="primary" onClick={loadIntoCart} disabled={itemsQuery.isLoading || items.length === 0}>
            <ShoppingCart className="h-4 w-4" /> Load into cart
          </Button>
        }
      />

      {itemsQuery.isLoading ? (
        <section className="panel p-4">
          <LoadingSkeleton rows={6} columns={[3, 1, 1, 1]} />
        </section>
      ) : itemsQuery.isError ? (
        <div className="panel p-8 text-center text-sm text-danger">
          We couldn&apos;t load this list. Please refresh or go back to your saved lists.
        </div>
      ) : (
        <section>
          <DataTable>
            <DataTableHeader>
              <tr>
                <DataTableHeaderCell>Product</DataTableHeaderCell>
                <DataTableHeaderCell>Variant</DataTableHeaderCell>
                <DataTableHeaderCell>SKU</DataTableHeaderCell>
                <DataTableHeaderCell align="right">Qty</DataTableHeaderCell>
              </tr>
            </DataTableHeader>
            <DataTableBody>
              {items.length === 0 ? (
                <DataTableEmpty
                  colSpan={4}
                  icon={<ListPlus className="h-6 w-6" />}
                  title="This list is empty"
                  message="Build a cart in the catalog and use “Save as list” to fill it."
                />
              ) : (
                items.map((item) => (
                  <DataTableRow key={item.id}>
                    <DataTableCell className="text-text-primary">{item.productTitle}</DataTableCell>
                    <DataTableCell className="text-text-secondary">{item.variantTitle ?? '—'}</DataTableCell>
                    <DataTableCell className="font-mono text-xs text-text-secondary">
                      {item.sku ?? '—'}
                    </DataTableCell>
                    <DataTableCell align="right">{item.quantity}</DataTableCell>
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </DataTable>
        </section>
      )}
    </>
  );
}
