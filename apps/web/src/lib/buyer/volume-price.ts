import type { VolumeBreakBracket } from '@/types/api';

/**
 * Client-side price PREVIEW helpers for the bulk-order grid.
 *
 * The web bundle deliberately has no decimal.js — the SERVER is the authoritative
 * pricer (`apps/api/src/pricing/pricing.service.ts`, ROUND_HALF_EVEN). These
 * functions mirror that service's `selectBracket` + `applyPercentage` semantics so
 * the "from $X" hint, the volume popover ladder, and the live unit/line totals shown
 * while typing match what the server will charge. They are display estimates only and
 * are NEVER sent in a write (the order DTO carries ids + quantities, no prices).
 */

/** Round a dollar amount to whole cents with banker's rounding (matches the server). */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const scaled = value * 100;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  let cents: number;
  if (Math.abs(diff - 0.5) < 1e-9) {
    // Exact half → round to the even cent.
    cents = floor % 2 === 0 ? floor : floor + 1;
  } else {
    cents = Math.round(scaled);
  }
  return cents / 100;
}

/** Unit price after a flat percentage off (display estimate). */
export function pctOffUnit(basePrice: string | number, pct: string | number): number {
  const base = typeof basePrice === 'number' ? basePrice : Number(basePrice);
  const p = typeof pct === 'number' ? pct : Number(pct);
  if (!Number.isFinite(base)) return 0;
  if (!Number.isFinite(p)) return roundMoney(base);
  return roundMoney(base * (1 - p / 100));
}

/**
 * The volume bracket that applies at `qty` — the one with the greatest `minQty`
 * still ≤ `qty` (brackets are ascending/contiguous). Returns null below the first
 * bracket (i.e. base price applies). Identical rule to the server's selectBracket.
 */
export function selectBracket(
  brackets: VolumeBreakBracket[] | null | undefined,
  qty: number,
): VolumeBreakBracket | null {
  if (!brackets || brackets.length === 0) return null;
  const sorted = [...brackets].sort((a, b) => a.minQty - b.minQty);
  let chosen: VolumeBreakBracket | null = null;
  for (const bracket of sorted) {
    if (qty >= bracket.minQty) chosen = bracket;
    else break;
  }
  return chosen;
}

/** Unit price for a volume-breaks variant at `qty` (base when below the first bracket). */
export function volumeUnitPrice(
  basePrice: string | number,
  brackets: VolumeBreakBracket[] | null | undefined,
  qty: number,
): number {
  const base = typeof basePrice === 'number' ? basePrice : Number(basePrice);
  if (!Number.isFinite(base)) return 0;
  const bracket = selectBracket(brackets, qty);
  return bracket ? pctOffUnit(base, bracket.discountPct) : roundMoney(base);
}

/** The lowest achievable unit price across all brackets — drives the "from $X" label. */
export function lowestVolumePrice(
  basePrice: string | number,
  brackets: VolumeBreakBracket[] | null | undefined,
): number {
  const base = typeof basePrice === 'number' ? basePrice : Number(basePrice);
  if (!Number.isFinite(base)) return 0;
  if (!brackets || brackets.length === 0) return roundMoney(base);
  const maxPct = brackets.reduce((max, b) => (b.discountPct > max ? b.discountPct : max), 0);
  return pctOffUnit(base, maxPct);
}
