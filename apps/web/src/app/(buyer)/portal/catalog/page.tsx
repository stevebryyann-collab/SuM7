'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { X, Upload, RotateCcw } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { BulkOrderTable } from '@/components/buyer/BulkOrderTable';
import { CsvPreviewModal } from '@/components/buyer/CsvPreviewModal';
import { useBuyerCatalog } from '@/hooks/useBuyerCatalog';
import { useBuyerMe } from '@/hooks/useBuyerAccount';
import { useOrders, useOrder } from '@/hooks/useOrders';
import { useBuyerMerchantId } from '@/components/providers/BuyerProviders';
import { formatDate, formatPaymentTerms } from '@/lib/format';
import type { CatalogProduct } from '@/types/api';

const WELCOME_DISMISS_KEY = 'b2b.catalog.welcome.dismissed';

/**
 * Buyer catalog + spreadsheet ordering. Loads the tier-priced catalog (infinite
 * cursor pagination) and feeds it into the virtualized {@link BulkOrderTable}. The
 * cart (variantId → qty) is owned here so search, CSV import, and "Reorder last
 * order" all write into the same order. Client-side instant search filters the
 * loaded products; a `stale` flag surfaces a soft "prices updating" badge.
 */
export default function CatalogPage(): JSX.Element {
  const [search, setSearch] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [csvOpen, setCsvOpen] = useState(false);
  const [reorderOpen, setReorderOpen] = useState(false);
  const [welcomeDismissed, setWelcomeDismissed] = useState(true);

  const merchantId = useBuyerMerchantId();
  const query = useBuyerCatalog('');
  const buyerMe = useBuyerMe();
  const orders = useOrders({ mode: 'buyer' });

  // Welcome bar shows once per browser (first visit).
  useEffect(() => {
    setWelcomeDismissed(localStorage.getItem(WELCOME_DISMISS_KEY) === '1');
  }, []);

  const dismissWelcome = (): void => {
    localStorage.setItem(WELCOME_DISMISS_KEY, '1');
    setWelcomeDismissed(true);
  };

  const allProducts = useMemo<CatalogProduct[]>(
    () => (query.data?.pages ?? []).flatMap((page) => page.products),
    [query.data],
  );
  const isStale = (query.data?.pages ?? []).some((page) => page.stale);

  // Client-side instant search across the loaded products (name or any SKU).
  const term = search.trim().toLowerCase();
  const filteredProducts = useMemo<CatalogProduct[]>(() => {
    if (!term) return allProducts;
    return allProducts.filter((product) => {
      if (product.title.toLowerCase().includes(term)) return true;
      return product.variants.some((variant) => variant.sku?.toLowerCase().includes(term));
    });
  }, [allProducts, term]);

  // Latest prior order → seeds "Reorder last order" (only when one exists).
  const lastOrder = orders.data?.pages[0]?.data[0] ?? null;
  const lastOrderDetail = useOrder('buyer', reorderOpen ? lastOrder?.id : undefined);

  const applyReorder = (): void => {
    const lineItems = lastOrderDetail.data?.lineItems ?? [];
    const updates: Record<string, number> = {};
    for (const line of lineItems) {
      if (line.shopifyVariantId && line.quantity > 0) updates[line.shopifyVariantId] = line.quantity;
    }
    setQuantities(updates);
    setReorderOpen(false);
    toast.success('Last order loaded');
  };

  return (
    <>
      <PageHeader
        title="Catalog"
        description="Enter quantities to build a bulk order. Prices reflect your negotiated tier."
        actions={isStale ? <StatusBadge status="processing" label="Prices updating" /> : undefined}
      />

      {!welcomeDismissed && buyerMe.data ? (
        <div className="mb-4 flex items-start justify-between gap-4 rounded-md border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-700">
            Welcome, <span className="font-medium text-gray-900">{buyerMe.data.companyName}</span>! Your account is
            set up with{' '}
            <span className="font-medium text-gray-900">{buyerMe.data.pricingTierName ?? 'standard'}</span> pricing
            and <span className="font-medium text-gray-900">{formatPaymentTerms(buyerMe.data.paymentTerms)}</span>{' '}
            payment terms.
          </p>
          <button
            type="button"
            onClick={dismissWelcome}
            aria-label="Dismiss welcome message"
            className="flex-shrink-0 rounded-sm text-gray-400 hover:text-gray-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Input
          placeholder="Search products, SKUs…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="h-9 w-72"
          aria-label="Search products"
        />
        <div className="flex items-center gap-2">
          <Button variant="default" onClick={() => setCsvOpen(true)} disabled={allProducts.length === 0}>
            <Upload className="h-3.5 w-3.5" /> Import from CSV
          </Button>
          {lastOrder ? (
            <Button variant="default" onClick={() => setReorderOpen(true)}>
              <RotateCcw className="h-3.5 w-3.5" /> Reorder last order
            </Button>
          ) : null}
        </div>
      </div>

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
          {term ? (
            <p className="mb-2 text-sm text-gray-500">
              Showing <span className="font-medium text-gray-900">{filteredProducts.length}</span> of{' '}
              <span className="font-medium text-gray-900">{allProducts.length}</span> products
            </p>
          ) : null}

          {term && filteredProducts.length === 0 ? (
            <div className="panel p-6 text-center text-sm text-gray-600">
              No products match “{search}”.{' '}
              <button type="button" className="text-accent hover:underline" onClick={() => setSearch('')}>
                Clear search.
              </button>
            </div>
          ) : (
            <BulkOrderTable
              products={filteredProducts}
              merchantId={merchantId}
              buyerMe={buyerMe.data}
              quantities={quantities}
              setQuantities={setQuantities}
              search={search}
            />
          )}

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

      <CsvPreviewModal
        open={csvOpen}
        onOpenChange={setCsvOpen}
        products={allProducts}
        onApply={(updates) => setQuantities((prev) => ({ ...prev, ...updates }))}
      />

      <ConfirmDialog
        open={reorderOpen}
        onOpenChange={setReorderOpen}
        title="Reorder last order?"
        description={
          <span>
            This will replace your current cart with items from your last order
            {lastOrder?.createdAt ? <> placed on {formatDate(lastOrder.createdAt)}</> : null}.
          </span>
        }
        confirmLabel="Load last order"
        isLoading={lastOrderDetail.isLoading}
        onConfirm={applyReorder}
      />
    </>
  );
}
