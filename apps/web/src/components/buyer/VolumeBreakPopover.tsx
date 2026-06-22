'use client';

import { Info } from 'lucide-react';
import { Popover } from '@/components/ui/popover';
import { formatMoney } from '@/lib/format';
import { pctOffUnit, selectBracket } from '@/lib/buyer/volume-price';
import { cn } from '@/lib/cn';
import type { VolumeBreakBracket } from '@/types/api';

interface Row {
  minQty: number;
  discountPct: number;
  isBase: boolean;
}

/**
 * The ⓘ volume-pricing breakdown shown next to a `volume_breaks` unit price. Lists
 * each quantity bracket with its per-unit price and discount, and highlights the
 * bracket that applies at the buyer's current quantity. Prices are display
 * estimates ({@link pctOffUnit}); the server is authoritative at checkout.
 */
export function VolumeBreakPopover({
  basePrice,
  brackets,
  currentQty,
}: {
  basePrice: string;
  brackets: VolumeBreakBracket[];
  currentQty: number;
}): JSX.Element {
  const sorted = [...brackets].sort((a, b) => a.minQty - b.minQty);
  const active = selectBracket(sorted, currentQty);
  const first = sorted[0];
  const rows: Row[] = [
    ...(first && first.minQty > 1 ? [{ minQty: 1, discountPct: 0, isBase: true }] : []),
    ...sorted.map((bracket) => ({ minQty: bracket.minQty, discountPct: bracket.discountPct, isBase: false })),
  ];

  return (
    <Popover
      label="Show volume pricing breakdown"
      align="end"
      trigger={<Info className="h-3.5 w-3.5 text-accent" />}
      className="w-64 p-0"
    >
      <div className="border-b border-gray-200 px-3 py-2">
        <p className="text-xs font-medium text-gray-900">Volume pricing</p>
        <p className="text-[11px] text-gray-500">Order more to unlock a lower unit price.</p>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
            <th className="px-3 py-1.5 font-medium">Quantity</th>
            <th className="px-3 py-1.5 text-right font-medium">Price / unit</th>
            <th className="px-3 py-1.5 text-right font-medium">You save</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const next = rows[index + 1];
            const rangeLabel = next ? `${row.minQty}–${next.minQty - 1}` : `${row.minQty}+`;
            const unit = pctOffUnit(basePrice, row.discountPct);
            const isActive = active ? !row.isBase && row.minQty === active.minQty : row.isBase;
            return (
              <tr key={row.minQty} className={cn('border-t border-gray-100', isActive && 'bg-blue-50')}>
                <td className="px-3 py-1.5 tabular-nums text-gray-700">{rangeLabel}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums text-gray-900">
                  {formatMoney(unit)}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">
                  {row.discountPct > 0 ? `${row.discountPct}%` : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Popover>
  );
}
