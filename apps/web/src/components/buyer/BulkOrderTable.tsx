'use client';

import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Info, LayoutGrid, List } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Tooltip } from '@/components/ui/tooltip';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/cn';
import { volumeUnitPrice, lowestVolumePrice } from '@/lib/buyer/volume-price';
import { VolumeBreakPopover } from './VolumeBreakPopover';
import { MatrixView } from './MatrixView';
import { ReviewOrderModal, type ReviewLine } from './ReviewOrderModal';
import type { BuyerMe, CatalogProduct, CatalogVariant } from '@/types/api';

/** One flattened variant row (a product may contribute many rows). */
interface VariantRow {
  product: CatalogProduct;
  variant: CatalogVariant;
}

const ROW_HEIGHT = 52;
const MAX_LINES = 500; // matches BulkOrderSchema.lineItems.max(500)

export interface BulkOrderTableProps {
  products: CatalogProduct[];
  /** The buyer's merchant tenant (read from the App-Proxy cookie by the layout). */
  merchantId: string;
  /** The buyer's own snapshot (terms, credit, min-order, BNPL) — undefined while loading. */
  buyerMe: BuyerMe | undefined;
  /** Shared cart: variantId → quantity (lifted to the page so CSV/Reorder share it). */
  quantities: Record<string, number>;
  setQuantities: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  /** Active free-text filter (instant, client-side). Highlights matches. */
  search: string;
}

/** Per-variant effective unit price for the buyer's tier (display estimate). */
function effectiveUnitPrice(variant: CatalogVariant, qty: number): number {
  if (variant.appliedTierType === 'volume_breaks' && variant.volumeBrackets) {
    return volumeUnitPrice(variant.basePrice, variant.volumeBrackets, Math.max(qty, 1));
  }
  return Number(variant.resolvedPrice) || 0;
}

/** Wrap case-insensitive matches of `term` in a highlight mark. */
function highlight(text: string, term: string): React.ReactNode {
  const needle = term.trim();
  if (!needle) return text;
  const lower = text.toLowerCase();
  const target = needle.toLowerCase();
  const out: React.ReactNode[] = [];
  let from = 0;
  let at = lower.indexOf(target, from);
  let key = 0;
  while (at !== -1) {
    if (at > from) out.push(text.slice(from, at));
    out.push(
      <mark key={key++} className="bg-yellow-200 text-inherit">
        {text.slice(at, at + target.length)}
      </mark>,
    );
    from = at + target.length;
    at = lower.indexOf(target, from);
  }
  if (from < text.length) out.push(text.slice(from));
  return out;
}

/**
 * Spreadsheet-style bulk order grid. Virtualized rows, per-variant quantity inputs
 * with a live cart subtotal (display only — the SERVER reprices on submit), tier
 * pricing cues (percentage-off badge + tooltip, volume "from $X" + live popover,
 * unavailable styling), keyboard quantity stepping, search-match highlighting, a
 * per-product matrix toggle, and a min-order-gated Review step.
 */
export function BulkOrderTable({
  products,
  merchantId,
  buyerMe,
  quantities,
  setQuantities,
  search,
}: BulkOrderTableProps): JSX.Element {
  const [reviewOpen, setReviewOpen] = useState(false);
  const [matrixProductIds, setMatrixProductIds] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  // List-mode rows exclude products currently shown as a matrix.
  const rows = useMemo<VariantRow[]>(
    () =>
      products
        .filter((product) => !matrixProductIds.has(product.shopifyProductId))
        .flatMap((product) => product.variants.map((variant) => ({ product, variant }))),
    [products, matrixProductIds],
  );
  const matrixProducts = useMemo<CatalogProduct[]>(
    () => products.filter((product) => matrixProductIds.has(product.shopifyProductId)),
    [products, matrixProductIds],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const setQty = (variantId: string, raw: string): void => {
    const qty = Math.max(0, Math.min(9999, Math.floor(Number(raw) || 0)));
    setQuantities((prev) => {
      const next = { ...prev };
      if (qty <= 0) delete next[variantId];
      else next[variantId] = qty;
      return next;
    });
  };

  const stepQty = (variantId: string, delta: number): void => {
    const current = quantities[variantId] ?? 0;
    setQty(variantId, String(current + delta));
  };

  const onQtyKeyDown = (event: KeyboardEvent<HTMLInputElement>, variantId: string): void => {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      stepQty(variantId, 1);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      stepQty(variantId, -1);
    }
  };

  const toggleMatrix = (productId: string): void => {
    setMatrixProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  // Build review lines + subtotal from the shared cart across ALL products.
  const variantIndex = useMemo(() => {
    const map = new Map<string, VariantRow>();
    for (const product of products) {
      for (const variant of product.variants) {
        map.set(variant.shopifyVariantId, { product, variant });
      }
    }
    return map;
  }, [products]);

  const reviewLines = useMemo<ReviewLine[]>(() => {
    const lines: ReviewLine[] = [];
    for (const [variantId, qty] of Object.entries(quantities)) {
      const row = variantIndex.get(variantId);
      if (!row || qty <= 0) continue;
      const unit = effectiveUnitPrice(row.variant, qty);
      lines.push({
        variantId,
        productId: row.product.shopifyProductId,
        productTitle: row.product.title,
        variantLabel: [row.variant.color, row.variant.size].filter(Boolean).join(' / ') || '—',
        sku: row.variant.sku,
        quantity: qty,
        unitPrice: unit,
        lineTotal: unit * qty,
      });
    }
    return lines.slice(0, MAX_LINES);
  }, [quantities, variantIndex]);

  const itemCount = reviewLines.reduce((sum, line) => sum + line.quantity, 0);
  const subtotal = reviewLines.reduce((sum, line) => sum + line.lineTotal, 0);
  const variantCount = reviewLines.length;

  const minOrder = buyerMe?.minOrderAmount ? Number(buyerMe.minOrderAmount) : 0;
  const belowMinimum = minOrder > 0 && subtotal < minOrder;
  const shortage = belowMinimum ? minOrder - subtotal : 0;
  const canReview = variantCount > 0 && !belowMinimum;

  return (
    <div className="panel flex flex-col">
      {/* Matrix-mode products render above the virtualized list. */}
      {matrixProducts.length > 0 ? (
        <div className="space-y-4 border-b border-gray-200 p-4">
          {matrixProducts.map((product) => (
            <div key={product.shopifyProductId} className="rounded-md border border-gray-200">
              <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
                <p className="text-sm font-medium text-gray-900">{product.title}</p>
                <Button variant="ghost" size="sm" onClick={() => toggleMatrix(product.shopifyProductId)}>
                  <List className="h-3.5 w-3.5" /> List view
                </Button>
              </div>
              <div className="p-3">
                <MatrixView product={product} quantities={quantities} onQtyChange={setQty} />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* Header row */}
      <div className="grid grid-cols-[1fr_120px_140px_110px_120px] gap-2 border-b border-gray-200 bg-gray-50 px-4 py-2 text-label uppercase tracking-wider text-gray-500">
        <span>Product</span>
        <span>SKU</span>
        <span className="text-right">Unit Price</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Line Total</span>
      </div>

      {/* Virtualized body */}
      <div ref={scrollRef} className="h-[480px] overflow-auto">
        {rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-500">
            {matrixProducts.length > 0 ? 'All products are in matrix view.' : 'No products available.'}
          </p>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index];
              if (!row) return null;
              const { product, variant } = row;
              const qty = quantities[variant.shopifyVariantId] ?? 0;
              const unit = effectiveUnitPrice(variant, qty);
              const lineTotal = qty * unit;
              const isVolume = variant.appliedTierType === 'volume_breaks' && Boolean(variant.volumeBrackets);
              const isPercent = variant.appliedTierType === 'percentage_off' && Boolean(variant.discountPct);
              const variantLabel = [variant.color, variant.size].filter(Boolean).join(' / ') || '—';
              const showMatrixToggle = product.colors.length > 0 && product.sizes.length > 0;

              return (
                <div
                  key={variant.shopifyVariantId}
                  className={cn(
                    'grid grid-cols-[1fr_120px_140px_110px_120px] items-center gap-2 border-b border-gray-100 px-4',
                    !variant.available && 'border-l-2 border-l-red-400',
                    variant.available && qty > 0 && 'border-l-2 border-l-accent',
                  )}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: ROW_HEIGHT,
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm text-gray-900">{highlight(product.title, search)}</p>
                      {showMatrixToggle ? (
                        <button
                          type="button"
                          onClick={() => toggleMatrix(product.shopifyProductId)}
                          className="flex flex-shrink-0 items-center gap-0.5 rounded text-[11px] text-gray-400 hover:text-gray-700"
                          aria-label={`Matrix view for ${product.title}`}
                        >
                          <LayoutGrid className="h-3 w-3" /> Matrix
                        </button>
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-gray-500">{variantLabel}</p>
                  </div>

                  <span className="truncate font-mono text-xs text-gray-600">
                    {variant.sku ? highlight(variant.sku, search) : '—'}
                  </span>

                  <div className="flex items-center justify-end gap-1.5 font-mono text-sm tabular-nums text-gray-900">
                    {!variant.available ? (
                      <Tooltip content="This product is currently unavailable.">
                        <span className="text-gray-400">—</span>
                      </Tooltip>
                    ) : isVolume ? (
                      <>
                        <span className="text-gray-500">from</span>
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

                  <div className="flex justify-end">
                    <Input
                      type="number"
                      min={0}
                      max={9999}
                      value={qty === 0 ? '' : qty}
                      disabled={!variant.available}
                      onChange={(event) => setQty(variant.shopifyVariantId, event.target.value)}
                      onKeyDown={(event) => onQtyKeyDown(event, variant.shopifyVariantId)}
                      className="h-8 w-24 text-right"
                      aria-label={`Quantity for ${product.title} ${variantLabel}`}
                    />
                  </div>

                  <span className="text-right font-mono text-sm tabular-nums text-gray-900">
                    {lineTotal > 0 ? formatMoney(lineTotal) : '$0.00'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Sticky footer / submit */}
      <div className="flex items-center justify-between gap-4 border-t border-gray-200 px-4 py-3">
        <div className="text-sm text-gray-600">
          <span className="font-medium text-gray-900 tabular-nums">{variantCount}</span> variant
          {variantCount === 1 ? '' : 's'} —{' '}
          <span className="font-medium text-gray-900 tabular-nums">{itemCount}</span> item
          {itemCount === 1 ? '' : 's'}
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-baseline gap-2">
            <span className="text-label uppercase tracking-wider text-gray-500">Subtotal</span>
            <span className="text-lg font-semibold tabular-nums text-gray-900">{formatMoney(subtotal)}</span>
          </div>
          <div className="flex flex-col items-end">
            {belowMinimum ? (
              <span className="mb-1 text-xs text-amber-700">
                Minimum order: {formatMoney(minOrder)}. Add {formatMoney(shortage)} more.
              </span>
            ) : null}
            {belowMinimum ? (
              <Tooltip content={`Add ${formatMoney(shortage)} more to reach the ${formatMoney(minOrder)} minimum.`}>
                <Button variant="primary" disabled onClick={() => setReviewOpen(true)}>
                  Review order
                </Button>
              </Tooltip>
            ) : (
              <Button variant="primary" disabled={!canReview} onClick={() => setReviewOpen(true)}>
                Review order
              </Button>
            )}
          </div>
        </div>
      </div>

      <ReviewOrderModal
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        lines={reviewLines}
        subtotal={subtotal}
        merchantId={merchantId}
        buyerMe={buyerMe}
        onPlaced={() => setQuantities({})}
      />
    </div>
  );
}
