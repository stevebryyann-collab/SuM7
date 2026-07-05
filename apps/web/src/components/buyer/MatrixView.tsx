'use client';

import { Input } from '@/components/ui/input';
import type { CatalogProduct, CatalogVariant } from '@/types/api';

interface MatrixViewProps {
  product: CatalogProduct;
  quantities: Record<string, number>;
  onQtyChange: (variantId: string, raw: string) => void;
}

/**
 * Size × color quantity grid for one product (fashion variant matrices). Rows are
 * colors, columns are sizes; each cell is a quantity input wired to the shared cart.
 * Row totals (right) and column totals (bottom) are item counts. Cells with no
 * matching variant render a dash.
 */
export function MatrixView({ product, quantities, onQtyChange }: MatrixViewProps): JSX.Element {
  const colors = product.colors.length > 0 ? product.colors : ['—'];
  const sizes = product.sizes.length > 0 ? product.sizes : ['—'];

  const byKey = new Map<string, CatalogVariant>();
  for (const variant of product.variants) {
    byKey.set(`${variant.color ?? '—'}|${variant.size ?? '—'}`, variant);
  }

  const rows = colors.map((color) => {
    const cells = sizes.map((size) => {
      const variant = byKey.get(`${color}|${size}`) ?? null;
      const qty = variant ? quantities[variant.shopifyVariantId] ?? 0 : 0;
      return { size, variant, qty };
    });
    return { color, cells, rowTotal: cells.reduce((sum, cell) => sum + cell.qty, 0) };
  });
  const colTotals = sizes.map((_, columnIndex) =>
    rows.reduce((sum, row) => sum + (row.cells[columnIndex]?.qty ?? 0), 0),
  );
  const grandTotal = rows.reduce((sum, row) => sum + row.rowTotal, 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="border-b border-border px-2 py-1.5 text-left text-label uppercase tracking-wide text-text-secondary">
              Color \ Size
            </th>
            {sizes.map((size) => (
              <th
                key={size}
                className="border-b border-border px-2 py-1.5 text-center text-xs font-medium text-text-secondary"
              >
                {size}
              </th>
            ))}
            <th className="border-b border-l border-border px-2 py-1.5 text-right text-label uppercase tracking-wide text-text-secondary">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.color} className="border-b border-border">
              <td className="px-2 py-1 text-xs text-text-secondary">{row.color}</td>
              {row.cells.map(({ size, variant, qty }) => (
                <td key={size} className="px-1 py-1 text-center">
                  {variant ? (
                    <Input
                      type="number"
                      min={0}
                      max={9999}
                      value={qty === 0 ? '' : qty}
                      disabled={!variant.available}
                      onChange={(event) => onQtyChange(variant.shopifyVariantId, event.target.value)}
                      className="h-8 w-16 text-center"
                      aria-label={`Quantity for ${product.title} ${row.color} ${size}`}
                    />
                  ) : (
                    <span className="text-text-tertiary">—</span>
                  )}
                </td>
              ))}
              <td className="border-l border-border px-2 py-1 text-right font-medium tabular-nums text-text-primary">
                {row.rowTotal}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border bg-white/40">
            <td className="px-2 py-1.5 text-label uppercase tracking-wide text-text-secondary">Total</td>
            {colTotals.map((total, index) => (
              <td
                key={sizes[index]}
                className="px-2 py-1.5 text-center font-medium tabular-nums text-text-primary"
              >
                {total}
              </td>
            ))}
            <td className="border-l border-border px-2 py-1.5 text-right font-semibold tabular-nums text-text-primary">
              {grandTotal}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
