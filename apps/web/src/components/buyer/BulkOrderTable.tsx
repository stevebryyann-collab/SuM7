'use client';

import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { toast } from 'sonner';
import { Upload, Info } from 'lucide-react';
import { BulkOrderSchema, type BulkOrderInput } from '@b2b/shared/schemas';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { ApiClientError } from '@/lib/api/error';
import { formatMoney } from '@/lib/format';
import { useCreateOrder } from '@/hooks/useCreateOrder';
import type { CatalogProduct, CatalogVariant, OrderCreatedResult } from '@/types/api';

/** One flattened variant row (a product may contribute many rows). */
interface VariantRow {
  product: CatalogProduct;
  variant: CatalogVariant;
}

const ROW_HEIGHT = 44;
const MAX_LINES = 500; // matches BulkOrderSchema.lineItems.max(500)

export interface BulkOrderTableProps {
  products: CatalogProduct[];
  /** The buyer's merchant tenant (read from the App-Proxy cookie by the layout). */
  merchantId: string;
}

/**
 * Spreadsheet-style bulk order grid. Features:
 *   - Virtualized rows (@tanstack/react-virtual) so thousands of variants stay
 *     smooth.
 *   - Per-variant quantity inputs with a live cart subtotal (display only —
 *     the SERVER is authoritative for pricing on submit).
 *   - CSV import (`sku,quantity` per line) that fills matching quantities.
 *   - A volume-break hint icon on variants priced via a `volume_breaks` tier.
 *
 * On submit it builds a {@link BulkOrderInput} with a fresh idempotency key and
 * posts via {@link useCreateOrder}. The merchant tenant is authoritative
 * server-side; `merchantId` here only satisfies request validation.
 */
export function BulkOrderTable({ products, merchantId }: BulkOrderTableProps): JSX.Element {
  const rows = useMemo<VariantRow[]>(
    () => products.flatMap((product) => product.variants.map((variant) => ({ product, variant }))),
    [products],
  );

  // variantId -> quantity. Sparse: only non-zero lines are kept.
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const createOrder = useCreateOrder();
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const setQty = (variantId: string, raw: string): void => {
    const qty = Math.max(0, Math.min(1_000_000, Math.floor(Number(raw) || 0)));
    setQuantities((prev) => {
      const next = { ...prev };
      if (qty <= 0) delete next[variantId];
      else next[variantId] = qty;
      return next;
    });
  };

  const cartLines = Object.entries(quantities);
  const cartCount = cartLines.length;
  const subtotal = useMemo(() => {
    let total = 0;
    for (const row of rows) {
      const qty = quantities[row.variant.shopifyVariantId];
      if (qty) total += qty * (Number(row.variant.resolvedPrice) || 0);
    }
    return total;
  }, [rows, quantities]);

  const handleCsv = async (file: File): Promise<void> => {
    const text = await file.text();
    const bySku = new Map<string, string>(); // sku -> variantId
    for (const row of rows) {
      if (row.variant.sku) bySku.set(row.variant.sku.trim().toLowerCase(), row.variant.shopifyVariantId);
    }
    let matched = 0;
    const updates: Record<string, number> = {};
    for (const line of text.split(/\r?\n/)) {
      const [skuRaw, qtyRaw] = line.split(',');
      if (!skuRaw || !qtyRaw) continue;
      const variantId = bySku.get(skuRaw.trim().toLowerCase());
      const qty = Math.floor(Number(qtyRaw.trim()) || 0);
      if (variantId && qty > 0) {
        updates[variantId] = qty;
        matched += 1;
      }
    }
    setQuantities((prev) => ({ ...prev, ...updates }));
    toast.success(`Imported ${matched} line${matched === 1 ? '' : 's'} from CSV`);
  };

  const submit = (): void => {
    const lineItems = rows
      .filter((row) => quantities[row.variant.shopifyVariantId])
      .slice(0, MAX_LINES)
      .map((row) => ({
        shopifyProductId: row.product.shopifyProductId,
        shopifyVariantId: row.variant.shopifyVariantId,
        quantity: quantities[row.variant.shopifyVariantId]!,
      }));

    const payload: BulkOrderInput = {
      idempotencyKey: crypto.randomUUID(),
      merchantId,
      lineItems,
    };

    const parsed = BulkOrderSchema.safeParse(payload);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Invalid order');
      return;
    }

    createOrder.mutate(parsed.data, {
      onSuccess: (result: OrderCreatedResult) => {
        toast.success(`Order ${result.shopifyOrderNumber} placed — total ${formatMoney(result.total)}`);
        setQuantities({});
        setConfirmOpen(false);
      },
      onError: (error) => {
        setConfirmOpen(false);
        toast.error(error instanceof ApiClientError ? error.message : 'Order failed');
      },
    });
  };

  return (
    <div className="panel flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4 border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span className="font-medium text-gray-900 tabular-nums">{cartCount}</span> line
          {cartCount === 1 ? '' : 's'} in cart
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleCsv(file);
              e.target.value = '';
            }}
          />
          <Button variant="default" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" />
            Import CSV
          </Button>
        </div>
      </div>

      {/* Header row */}
      <div className="grid grid-cols-[1fr_120px_120px_120px_120px] gap-2 border-b border-gray-200 bg-gray-50 px-4 py-2 text-label uppercase tracking-wider text-gray-500">
        <span>Product</span>
        <span>SKU</span>
        <span className="text-right">Unit Price</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Line Total</span>
      </div>

      {/* Virtualized body */}
      <div ref={scrollRef} className="h-[480px] overflow-auto">
        {rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-500">No products available.</p>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index];
              if (!row) return null;
              const { product, variant } = row;
              const qty = quantities[variant.shopifyVariantId] ?? 0;
              const lineTotal = qty * (Number(variant.resolvedPrice) || 0);
              const isVolume = variant.appliedTierType === 'volume_breaks';
              return (
                <div
                  key={variant.shopifyVariantId}
                  className="grid grid-cols-[1fr_120px_120px_120px_120px] items-center gap-2 border-b border-gray-100 px-4"
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
                    <p className="truncate text-sm text-gray-900">{product.title}</p>
                    <p className="truncate text-xs text-gray-500">
                      {[variant.color, variant.size].filter(Boolean).join(' / ') || '—'}
                      {!variant.available ? (
                        <StatusBadge status="cancelled" label="Unavailable" className="ml-2" />
                      ) : null}
                    </p>
                  </div>
                  <span className="truncate font-mono text-xs text-gray-600">{variant.sku ?? '—'}</span>
                  <div className="flex items-center justify-end gap-1 font-mono text-sm tabular-nums text-gray-900">
                    {formatMoney(variant.resolvedPrice)}
                    {isVolume ? (
                      <span title="Volume pricing — order more to unlock a lower unit price">
                        <Info className="h-3.5 w-3.5 text-accent" aria-label="Volume break pricing" />
                      </span>
                    ) : null}
                  </div>
                  <div className="flex justify-end">
                    <Input
                      type="number"
                      min={0}
                      max={1_000_000}
                      value={qty === 0 ? '' : qty}
                      disabled={!variant.available}
                      onChange={(e) => setQty(variant.shopifyVariantId, e.target.value)}
                      className="h-8 w-24 text-right"
                      aria-label={`Quantity for ${product.title} ${variant.sku ?? ''}`}
                    />
                  </div>
                  <span className="text-right font-mono text-sm tabular-nums text-gray-900">
                    {lineTotal > 0 ? formatMoney(lineTotal) : '—'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer / submit */}
      <div className="flex items-center justify-between gap-4 border-t border-gray-200 px-4 py-3">
        <div className="flex items-baseline gap-2">
          <span className="text-label uppercase tracking-wider text-gray-500">Subtotal</span>
          <span className="text-lg font-semibold tabular-nums text-gray-900">{formatMoney(subtotal)}</span>
        </div>
        <Button
          variant="primary"
          disabled={cartCount === 0 || createOrder.isPending}
          onClick={() => setConfirmOpen(true)}
        >
          {createOrder.isPending ? <Spinner /> : null}
          Review &amp; place order
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Place this order?"
        description={
          <span>
            {cartCount} line{cartCount === 1 ? '' : 's'}, estimated subtotal{' '}
            <span className="font-medium text-gray-900">{formatMoney(subtotal)}</span>. Final pricing and
            totals are computed by the server. An invoice will be generated automatically.
          </span>
        }
        confirmLabel="Place order"
        isLoading={createOrder.isPending}
        onConfirm={submit}
      />
    </div>
  );
}
