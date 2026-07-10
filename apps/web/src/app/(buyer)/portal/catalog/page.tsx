'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Upload, RotateCcw, Bookmark } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { BulkOrderTable } from '@/components/buyer/BulkOrderTable';
import { FirstUseWelcome } from '@/components/buyer/FirstUseWelcome';
import { CsvPreviewModal } from '@/components/buyer/CsvPreviewModal';
import { SaveToListModal } from '@/components/buyer/SaveToListModal';
import { useBuyerCatalog } from '@/hooks/useBuyerCatalog';
import type { SaveCartItemInput } from '@/hooks/useShoppingLists';
import { useBuyerMe } from '@/hooks/useBuyerAccount';
import { useOrders, useOrder } from '@/hooks/useOrders';
import { useBuyerMerchantId } from '@/components/providers/BuyerProviders';
import { consumeCartSeed } from '@/lib/cart-seed';
import { formatDate } from '@/lib/format';
import type { CatalogProduct } from '@/types/api';

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
  const [saveListOpen, setSaveListOpen] = useState(false);

  const merchantId = useBuyerMerchantId();
  const query = useBuyerCatalog('');
  const buyerMe = useBuyerMe();
  const orders = useOrders({ mode: 'buyer' });

  const allProducts = useMemo<CatalogProduct[]>(
    () => (query.data?.pages ?? []).flatMap((page) => page.products),
    [query.data],
  );
  const isStale = (query.data?.pages ?? []).some((page) => page.stale);

  // Seed the cart from a saved list / past order handed off via sessionStorage
  // (see lib/cart-seed). Runs once on mount, before any user edits.
  useEffect(() => {
    const seed = consumeCartSeed();
    if (seed) {
      setQuantities((prev) => ({ ...prev, ...seed }));
      toast.success('Loaded into your cart');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Flatten the working cart to save-cart line shape (attach product/variant
  // metadata from the loaded catalog). Capped at the API's 200-item list limit.
  const cartLines = useMemo<SaveCartItemInput[]>(() => {
    const index = new Map<
      string,
      { productId: string; productTitle: string; variantTitle?: string; sku?: string }
    >();
    for (const product of allProducts) {
      for (const variant of product.variants) {
        index.set(variant.shopifyVariantId, {
          productId: product.shopifyProductId,
          productTitle: product.title,
          variantTitle: [variant.color, variant.size].filter(Boolean).join(' / ') || undefined,
          sku: variant.sku ?? undefined,
        });
      }
    }
    const lines: SaveCartItemInput[] = [];
    for (const [variantId, qty] of Object.entries(quantities)) {
      if (qty <= 0) continue;
      const meta = index.get(variantId);
      if (!meta) continue;
      lines.push({
        shopifyVariantId: variantId,
        shopifyProductId: meta.productId,
        productTitle: meta.productTitle,
        variantTitle: meta.variantTitle,
        sku: meta.sku,
        quantity: qty,
      });
    }
    return lines.slice(0, 200);
  }, [allProducts, quantities]);

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

      {buyerMe.data ? <FirstUseWelcome buyerMe={buyerMe.data} /> : null}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Input
          placeholder="Search products, SKUs…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="h-9 w-full sm:w-72"
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
          <Button variant="default" onClick={() => setSaveListOpen(true)} disabled={cartLines.length === 0}>
            <Bookmark className="h-3.5 w-3.5" /> Save as list
          </Button>
        </div>
      </div>

      {query.isLoading ? (
        <div className="panel p-4">
          <LoadingSkeleton rows={10} columns={[3, 1, 1, 1, 1]} />
        </div>
      ) : query.isError ? (
        <div className="panel p-6 text-sm text-red-700">Failed to load the catalog. Please refresh.</div>
      ) : merchantId === null ? (
        <div className="panel p-6 text-sm text-text-secondary">
          Unable to resolve your merchant context. Please return to the store and re-open the portal.
        </div>
      ) : (
        <>
          {term ? (
            <p className="mb-2 text-sm text-text-secondary">
              Showing <span className="font-medium text-text-primary">{filteredProducts.length}</span> of{' '}
              <span className="font-medium text-text-primary">{allProducts.length}</span> products
            </p>
          ) : null}

          {term && filteredProducts.length === 0 ? (
            <div className="panel p-6 text-center text-sm text-text-secondary">
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

      <SaveToListModal open={saveListOpen} onOpenChange={setSaveListOpen} items={cartLines} />

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
