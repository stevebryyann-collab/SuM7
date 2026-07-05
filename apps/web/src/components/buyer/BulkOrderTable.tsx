'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
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

  // Micro-interaction: briefly flash a unit-price cell to the accent color when a
  // quantity edit crosses a volume-break bracket (i.e. the unit price changed).
  const [priceFlashing, setPriceFlashing] = useState<Set<string>>(new Set());
  const flashTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const flashPrice = useCallback((variantId: string): void => {
    setPriceFlashing((prev) => new Set(prev).add(variantId));
    const existing = flashTimers.current.get(variantId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      setPriceFlashing((prev) => {
        const next = new Set(prev);
        next.delete(variantId);
        return next;
      });
      flashTimers.current.delete(variantId);
    }, 300);
    flashTimers.current.set(variantId, timer);
  }, []);
  useEffect(
    () => () => {
      for (const timer of flashTimers.current.values()) clearTimeout(timer);
    },
    [],
  );

  // Micro-interaction: pulse the footer item-count number when it changes.
  const [cartCountPulsing, setCartCountPulsing] = useState(false);
  const prevItemCount = useRef(0);

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
    // Flash the price cell when this quantity crosses a volume-break bracket.
    const row = variantIndex.get(variantId);
    if (row) {
      const prevQty = quantities[variantId] ?? 0;
      const before = effectiveUnitPrice(row.variant, Math.max(prevQty, 1));
      const after = effectiveUnitPrice(row.variant, Math.max(qty, 1));
      if (before !== after) flashPrice(variantId);
    }
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

  useEffect(() => {
    if (itemCount === prevItemCount.current) return;
    prevItemCount.current = itemCount;
    setCartCountPulsing(true);
    const timer = setTimeout(() => setCartCountPulsing(false), 200);
    return () => clearTimeout(timer);
  }, [itemCount]);

  const minOrder = buyerMe?.minOrderAmount ? Number(buyerMe.minOrderAmount) : 0;
  const belowMinimum = minOrder > 0 && subtotal < minOrder;
  const shortage = belowMinimum ? minOrder - subtotal : 0;

  // Credit utilization (Task 8) — reuses the buyer's own snapshot (no extra call).
  // The bar reflects committed used + the current cart; an order that would breach
  // the limit turns the bar red and blocks Review.
  const creditLimitNum = buyerMe?.creditLimit ? Number(buyerMe.creditLimit) : 0;
  const creditUsedNum = buyerMe?.creditUsed ? Number(buyerMe.creditUsed) : 0;
  const hasCredit = creditLimitNum > 0;
  const projectedCredit = creditUsedNum + subtotal;
  const creditUtil = hasCredit ? projectedCredit / creditLimitNum : 0;
  const exceedsCredit = hasCredit && projectedCredit > creditLimitNum;
  const creditBarPct = Math.min(creditUtil * 100, 100);
  const creditColor =
    exceedsCredit || creditUtil >= 0.9
      ? 'var(--color-danger)'
      : creditUtil >= 0.7
        ? 'var(--color-warning)'
        : 'var(--color-success)';

  const canReview = variantCount > 0 && !belowMinimum && !exceedsCredit;

  return (
    <div className="panel flex flex-col">
      {/* Matrix-mode products render above the virtualized list. */}
      {matrixProducts.length > 0 ? (
        <div className="space-y-4 border-b border-border p-4">
          {matrixProducts.map((product) => (
            <div key={product.shopifyProductId} className="rounded-md border border-border">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <p className="text-sm font-medium text-text-primary">{product.title}</p>
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
      <div className="grid grid-cols-[1fr_84px_96px] gap-2 border-b border-border bg-fog-soft px-4 py-2 text-label uppercase tracking-wider text-text-secondary md:grid-cols-[1fr_120px_140px_110px_120px]">
        <span>Product</span>
        <span className="hidden md:inline">SKU</span>
        <span className="hidden text-right md:inline">Unit Price</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Line Total</span>
      </div>

      {/* Virtualized body */}
      <div ref={scrollRef} className="h-[480px] overflow-auto">
        {rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-text-secondary">
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
                    'grid grid-cols-[1fr_84px_96px] items-center gap-2 border-b border-l-2 border-border px-4 md:grid-cols-[1fr_120px_140px_110px_120px]',
                    !variant.available
                      ? 'border-l-red-400'
                      : qty > 0
                        ? 'border-l-accent'
                        : 'border-l-transparent',
                  )}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: ROW_HEIGHT,
                    transform: `translateY(${item.start}px)`,
                    transition: 'border-left-color 150ms ease',
                  }}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm text-text-primary">{highlight(product.title, search)}</p>
                      {showMatrixToggle ? (
                        <button
                          type="button"
                          onClick={() => toggleMatrix(product.shopifyProductId)}
                          className="flex flex-shrink-0 items-center gap-0.5 rounded text-[11px] text-text-tertiary hover:text-text-secondary"
                          aria-label={`Matrix view for ${product.title}`}
                        >
                          <LayoutGrid className="h-3 w-3" /> Matrix
                        </button>
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-text-secondary">{variantLabel}</p>
                  </div>

                  <span className="hidden truncate font-mono text-xs text-text-secondary md:block">
                    {variant.sku ? highlight(variant.sku, search) : '—'}
                  </span>

                  <div
                    data-testid="financial-cell"
                    className={cn(
                      'hidden items-center justify-end gap-1.5 font-mono text-sm tabular-nums md:flex',
                      priceFlashing.has(variant.shopifyVariantId) ? 'text-accent' : 'text-text-primary',
                    )}
                    style={{ transition: 'color 300ms ease' }}
                  >
                    {!variant.available ? (
                      <Tooltip content="This product is currently unavailable.">
                        <span className="text-text-tertiary">—</span>
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

                  <div className="flex justify-end">
                    <Input
                      type="number"
                      min={0}
                      max={9999}
                      value={qty === 0 ? '' : qty}
                      placeholder="—"
                      disabled={!variant.available}
                      onChange={(event) => setQty(variant.shopifyVariantId, event.target.value)}
                      onKeyDown={(event) => onQtyKeyDown(event, variant.shopifyVariantId)}
                      className="h-8 w-24 text-right"
                      aria-label={`Quantity for ${product.title} ${variantLabel}`}
                    />
                  </div>

                  <span className="text-right font-mono text-sm tabular-nums text-text-primary">
                    {lineTotal > 0 ? formatMoney(lineTotal) : '$0.00'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Sticky cart footer / submit */}
      <div
        data-testid="cart-footer"
        className="sticky bottom-14 z-10 flex flex-col border-t border-glass-border bg-glass-strong backdrop-blur-nav shadow-glass md:bottom-0"
      >
        {/* Credit utilization bar — desktop only (mobile shows it in Review). */}
        {hasCredit ? (
          <div className="hidden h-[3px] w-full bg-neutral-bg md:block" aria-hidden>
            <div
              className="h-full"
              style={{ width: `${creditBarPct}%`, backgroundColor: creditColor, transition: 'width 200ms ease, background-color 200ms ease' }}
            />
          </div>
        ) : null}

        <div className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:justify-between md:gap-4">
          <div className="flex flex-col gap-0.5 text-sm text-text-secondary">
            <div>
              <span className="hidden md:inline">
                <span className="font-medium text-text-primary tabular-nums">{variantCount}</span> variant
                {variantCount === 1 ? '' : 's'} —{' '}
              </span>
              <span
                className={cn(
                  'inline-block font-medium text-text-primary tabular-nums',
                  cartCountPulsing ? 'scale-110' : 'scale-100',
                )}
                style={{ transition: 'transform 200ms ease' }}
              >
                {itemCount}
              </span>{' '}
              item{itemCount === 1 ? '' : 's'}
              <span className="md:hidden">
                {' '}
                •{' '}
                <span
                  data-testid="financial-cell"
                  className="font-mono font-semibold text-text-primary tabular-nums"
                >
                  {formatMoney(subtotal)}
                </span>
              </span>
            </div>
            {hasCredit ? (
              <span className="hidden text-xs text-text-secondary md:inline">
                Credit: <span className="font-mono tabular-nums text-text-secondary">{formatMoney(buyerMe?.creditUsed ?? 0)}</span> of{' '}
                <span className="font-mono tabular-nums text-text-secondary">{formatMoney(creditLimitNum)}</span> used
              </span>
            ) : null}
          </div>

          <div className="flex flex-col items-stretch gap-1 md:flex-row md:items-center md:gap-4">
            <div className="hidden items-baseline gap-2 md:flex">
              <span className="text-label uppercase tracking-wider text-text-secondary">Subtotal</span>
              <span data-testid="financial-cell" className="text-lg font-semibold tabular-nums text-text-primary">
                {formatMoney(subtotal)}
              </span>
            </div>
            {belowMinimum ? (
              <span className="text-xs text-amber-700">
                Minimum order: {formatMoney(minOrder)}. Add {formatMoney(shortage)} more.
              </span>
            ) : null}
            {exceedsCredit ? (
              <span className="text-xs text-danger">
                ⚠ This order would exceed your credit limit. Adjust your cart or contact the merchant.
              </span>
            ) : null}
            <Button
              variant="primary"
              className="w-full md:w-auto"
              disabled={!canReview}
              onClick={() => setReviewOpen(true)}
            >
              Review order
            </Button>
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
