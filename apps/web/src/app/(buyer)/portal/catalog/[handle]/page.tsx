'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { notFound, useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ShoppingCart } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip } from '@/components/ui/tooltip';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton';
import { MatrixView } from '@/components/buyer/MatrixView';
import { VolumeBreakPopover } from '@/components/buyer/VolumeBreakPopover';
import { toast } from '@/components/shared/toasts';
import { useBuyerProduct } from '@/hooks/useBuyerCatalog';
import { ApiClientError } from '@/lib/api/error';
import { stageCartSeed } from '@/lib/cart-seed';
import { formatMoney } from '@/lib/format';
import { volumeUnitPrice, lowestVolumePrice } from '@/lib/buyer/volume-price';
import { cn } from '@/lib/cn';
import type { CatalogProduct, CatalogVariant } from '@/types/api';

/** Effective per-unit price at a given quantity (display estimate; server reprices). */
function unitPriceFor(variant: CatalogVariant, qty: number): number {
  if (variant.appliedTierType === 'volume_breaks' && variant.volumeBrackets) {
    return volumeUnitPrice(variant.basePrice, variant.volumeBrackets, Math.max(qty, 1));
  }
  return Number(variant.resolvedPrice) || 0;
}

/** Lowest achievable unit price for a variant — drives the "from $X" hint. */
function fromPriceFor(variant: CatalogVariant): number {
  if (variant.appliedTierType === 'volume_breaks' && variant.volumeBrackets) {
    return lowestVolumePrice(variant.basePrice, variant.volumeBrackets);
  }
  return Number(variant.resolvedPrice) || 0;
}

/**
 * Buyer product detail — one product, tier-priced, reachable from the catalog
 * rows. Reuses the size×color {@link MatrixView} for fashion variant grids (or a
 * plain variant list otherwise) and the {@link VolumeBreakPopover} for volume
 * pricing. Quantities entered here seed the catalog cart via the sessionStorage
 * handoff, where the order is reviewed and submitted.
 */
export default function ProductDetailPage(): JSX.Element {
  const params = useParams<{ handle: string }>();
  const handle = params?.handle ?? null;
  const router = useRouter();
  const query = useBuyerProduct(handle);
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  if (query.error instanceof ApiClientError && query.error.statusCode === 404) {
    notFound();
  }

  const setQty = (variantId: string, raw: string): void => {
    const qty = Math.max(0, Math.min(9999, Math.floor(Number(raw) || 0)));
    setQuantities((prev) => {
      const next = { ...prev };
      if (qty <= 0) delete next[variantId];
      else next[variantId] = qty;
      return next;
    });
  };

  const product = query.data;

  const summary = useMemo(() => {
    if (!product) return { units: 0, subtotal: 0, fromPrice: 0 };
    let units = 0;
    let subtotal = 0;
    for (const variant of product.variants) {
      const qty = quantities[variant.shopifyVariantId] ?? 0;
      units += qty;
      subtotal += qty * unitPriceFor(variant, qty);
    }
    const candidates = product.variants
      .filter((variant) => variant.available)
      .map(fromPriceFor)
      .filter((price) => price > 0);
    const fromPrice = candidates.length > 0 ? Math.min(...candidates) : 0;
    return { units, subtotal, fromPrice };
  }, [product, quantities]);

  const addToCart = (): void => {
    if (!stageCartSeed(quantities)) {
      toast.error('Enter a quantity first.');
      return;
    }
    toast.success('Added to your cart');
    router.push('/portal/catalog');
  };

  const backLink = (
    <Link
      href="/portal/catalog"
      className="mb-4 inline-flex items-center gap-1 text-sm text-accent hover:underline"
    >
      <ArrowLeft className="h-4 w-4" /> Back to catalog
    </Link>
  );

  if (query.isLoading) {
    return (
      <>
        {backLink}
        <PageHeader title="Product" description="Loading…" />
        <section className="panel p-4">
          <LoadingSkeleton rows={6} columns={[3, 1, 1, 1]} />
        </section>
      </>
    );
  }

  if (query.isError || !product) {
    return (
      <>
        {backLink}
        <div className="panel p-8 text-center text-sm text-danger">
          We couldn&apos;t load this product. Please refresh or go back to the catalog.
        </div>
      </>
    );
  }

  const useMatrix = product.colors.length > 0 && product.sizes.length > 0;
  const subtitle = [product.vendor, product.productType].filter(Boolean).join(' · ');

  return (
    <>
      {backLink}

      <PageHeader
        title={product.title}
        description={subtitle || undefined}
        actions={
          <Button variant="primary" onClick={addToCart} disabled={summary.units === 0}>
            <ShoppingCart className="h-4 w-4" /> Add to cart
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Variants */}
        <section className="lg:col-span-2">
          <div className="panel p-5">
            <div className="mb-4 flex flex-wrap items-baseline gap-2">
              {summary.fromPrice > 0 ? (
                <>
                  <span className="text-sm text-text-secondary">From</span>
                  <span
                    className="font-mono text-2xl font-semibold tabular-nums text-text-primary"
                    data-testid="financial-cell"
                  >
                    {formatMoney(summary.fromPrice)}
                  </span>
                  <span className="text-sm text-text-secondary">/ unit</span>
                </>
              ) : (
                <span className="text-sm text-text-secondary">Pricing unavailable</span>
              )}
            </div>

            {useMatrix ? (
              <MatrixView product={product} quantities={quantities} onQtyChange={setQty} />
            ) : (
              <VariantList product={product} quantities={quantities} onQtyChange={setQty} />
            )}
          </div>
        </section>

        {/* Order summary */}
        <section>
          <div className="panel p-5 lg:sticky lg:top-6">
            <h2 className="mb-3 text-sm font-medium text-text-primary">Order summary</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-text-secondary">Units</dt>
                <dd className="tabular-nums text-text-primary">{summary.units}</dd>
              </div>
              <div className="flex items-center justify-between border-t border-border pt-2">
                <dt className="text-text-secondary">Estimated subtotal</dt>
                <dd className="font-mono font-semibold tabular-nums text-text-primary" data-testid="financial-cell">
                  {formatMoney(summary.subtotal)}
                </dd>
              </div>
            </dl>
            <Button variant="primary" className="mt-4 w-full" onClick={addToCart} disabled={summary.units === 0}>
              <ShoppingCart className="h-4 w-4" /> Add to cart
            </Button>
            <p className="mt-3 text-xs text-text-tertiary">
              Prices reflect your negotiated tier. Your cart total and any order minimum are confirmed on the
              catalog before you submit.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}

/** Non-matrix variant list — a priced row + quantity input per variant. */
function VariantList({
  product,
  quantities,
  onQtyChange,
}: {
  product: CatalogProduct;
  quantities: Record<string, number>;
  onQtyChange: (variantId: string, raw: string) => void;
}): JSX.Element {
  return (
    <div className="divide-y divide-border">
      {product.variants.map((variant) => {
        const qty = quantities[variant.shopifyVariantId] ?? 0;
        const unit = unitPriceFor(variant, qty);
        const label = [variant.color, variant.size].filter(Boolean).join(' / ') || variant.sku || 'Default';
        const isVolume = variant.appliedTierType === 'volume_breaks' && Boolean(variant.volumeBrackets);
        const isPercent = variant.appliedTierType === 'percentage_off' && Boolean(variant.discountPct);

        return (
          <div
            key={variant.shopifyVariantId}
            className={cn(
              'flex items-center gap-3 py-3',
              !variant.available && 'opacity-60',
            )}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-text-primary">{label}</p>
              {variant.sku ? <p className="truncate text-xs text-text-tertiary">SKU {variant.sku}</p> : null}
            </div>

            <div
              className="flex items-center justify-end gap-1.5 font-mono text-sm tabular-nums text-text-primary"
              data-testid="financial-cell"
            >
              {!variant.available ? (
                <Tooltip content="This variant is currently unavailable.">
                  <span className="text-text-tertiary">Unavailable</span>
                </Tooltip>
              ) : isVolume ? (
                <>
                  <span className="text-text-secondary">from</span>
                  {formatMoney(lowestVolumePrice(variant.basePrice, variant.volumeBrackets))}
                  <VolumeBreakPopover
                    basePrice={variant.basePrice}
                    brackets={variant.volumeBrackets ?? []}
                    currentQty={qty}
                  />
                </>
              ) : isPercent ? (
                <>
                  {formatMoney(unit)}
                  <Tooltip
                    content={
                      <span>
                        Original price: {formatMoney(variant.basePrice)} — You save {Number(variant.discountPct)}%
                      </span>
                    }
                  >
                    <StatusBadge status="approved" label={`${Number(variant.discountPct)}% off`} />
                  </Tooltip>
                </>
              ) : (
                formatMoney(unit)
              )}
            </div>

            <Input
              type="number"
              min={0}
              max={9999}
              value={qty === 0 ? '' : qty}
              placeholder="—"
              disabled={!variant.available}
              onChange={(event) => onQtyChange(variant.shopifyVariantId, event.target.value)}
              className="h-8 w-24 text-right"
              aria-label={`Quantity for ${product.title} ${label}`}
            />
          </div>
        );
      })}
    </div>
  );
}
