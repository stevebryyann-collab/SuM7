'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Upload, Check, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { CatalogProduct } from '@/types/api';

interface PreviewRow {
  sku: string;
  productTitle: string | null;
  variantLabel: string | null;
  quantity: number;
  variantId: string | null;
  ready: boolean;
}

interface CsvPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: CatalogProduct[];
  /** Apply matched (sku→variant) quantities into the shared cart. */
  onApply: (updates: Record<string, number>) => void;
}

/**
 * CSV import with a confirmation preview. Parses `SKU,Quantity` lines, matches each
 * SKU against the loaded catalog, and shows a Ready/Skip status per row before the
 * buyer applies the matched quantities to the order. Header rows and unparseable
 * quantities are ignored.
 */
export function CsvPreviewModal({
  open,
  onOpenChange,
  products,
  onApply,
}: CsvPreviewModalProps): JSX.Element {
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const buildSkuIndex = (): Map<string, { variantId: string; productTitle: string; variantLabel: string }> => {
    const map = new Map<string, { variantId: string; productTitle: string; variantLabel: string }>();
    for (const product of products) {
      for (const variant of product.variants) {
        if (variant.sku) {
          map.set(variant.sku.trim().toLowerCase(), {
            variantId: variant.shopifyVariantId,
            productTitle: product.title,
            variantLabel: [variant.color, variant.size].filter(Boolean).join(' / ') || '—',
          });
        }
      }
    }
    return map;
  };

  const parse = async (file: File): Promise<void> => {
    const text = await file.text();
    const index = buildSkuIndex();
    const parsed: PreviewRow[] = [];
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const [skuRaw, qtyRaw] = trimmed.split(',');
      if (!skuRaw) continue;
      const sku = skuRaw.trim();
      const quantity = Math.floor(Number((qtyRaw ?? '').trim()));
      // Skip a header row ("sku,quantity") or any non-positive / unparseable quantity.
      if (!Number.isFinite(quantity) || quantity <= 0) continue;
      const match = index.get(sku.toLowerCase());
      parsed.push({
        sku,
        productTitle: match?.productTitle ?? null,
        variantLabel: match?.variantLabel ?? null,
        quantity,
        variantId: match?.variantId ?? null,
        ready: Boolean(match),
      });
    }
    setRows(parsed);
  };

  const reset = (): void => {
    setRows(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const close = (next: boolean): void => {
    if (!next) reset();
    onOpenChange(next);
  };

  const readyRows = rows?.filter((row) => row.ready) ?? [];
  const skippedCount = (rows?.length ?? 0) - readyRows.length;

  const apply = (): void => {
    const updates: Record<string, number> = {};
    for (const row of readyRows) {
      if (row.variantId) updates[row.variantId] = row.quantity;
    }
    onApply(updates);
    toast.success(`CSV imported. ${readyRows.length} product${readyRows.length === 1 ? '' : 's'} added.`);
    close(false);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import from CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV with two columns: <span className="font-mono">SKU,Quantity</span>. Matching products are
            added to your order.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void parse(file);
            }}
          />
          {rows === null ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center gap-2 rounded-md border border-dashed border-border-strong bg-white/40 px-6 py-10 text-sm text-text-secondary hover:bg-fog-soft"
            >
              <Upload className="h-5 w-5 text-text-tertiary" />
              Choose a CSV file
            </button>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between gap-3 text-sm">
                <p className="text-text-secondary">
                  <span className="font-medium text-text-primary">{readyRows.length}</span> product
                  {readyRows.length === 1 ? '' : 's'} ready to import.
                  {skippedCount > 0 ? (
                    <>
                      {' '}
                      <span className="font-medium text-text-primary">{skippedCount}</span> SKU
                      {skippedCount === 1 ? '' : 's'} not found and will be skipped.
                    </>
                  ) : null}
                </p>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => {
                    reset();
                    fileRef.current?.click();
                  }}
                >
                  Choose another
                </Button>
              </div>
              <div className="max-h-72 overflow-y-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-fog-soft">
                    <tr className="text-left text-label uppercase tracking-wide text-text-secondary">
                      <th className="px-3 py-2 font-medium">SKU</th>
                      <th className="px-3 py-2 font-medium">Product</th>
                      <th className="px-3 py-2 text-right font-medium">Qty</th>
                      <th className="px-3 py-2 text-right font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => (
                      <tr key={`${row.sku}-${index}`} className="border-t border-border">
                        <td className="px-3 py-1.5 font-mono text-xs text-text-secondary">{row.sku}</td>
                        <td className="px-3 py-1.5 text-text-secondary">
                          {row.productTitle ? (
                            <span>
                              {row.productTitle}
                              {row.variantLabel && row.variantLabel !== '—' ? (
                                <span className="text-text-tertiary"> · {row.variantLabel}</span>
                              ) : null}
                            </span>
                          ) : (
                            <span className="text-text-tertiary">Not found</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-text-secondary">{row.quantity}</td>
                        <td className="px-3 py-1.5 text-right">
                          {row.ready ? (
                            <span className="inline-flex items-center gap-1 text-green-700">
                              <Check className="h-3.5 w-3.5" /> Ready
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-red-600">
                              <X className="h-3.5 w-3.5" /> Skip
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-3 py-6 text-center text-text-secondary">
                          No valid rows found in this file.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="default" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={readyRows.length === 0} onClick={apply}>
            Apply to order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
