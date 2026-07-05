/**
 * Cross-page cart handoff. The buyer catalog owns the working cart (variantId →
 * qty) in local React state, so other surfaces — a saved list, a past order —
 * can't write into it directly. They instead "stage" a seed here (sessionStorage)
 * and navigate to `/portal/catalog`, which consumes and clears it on mount.
 *
 * sessionStorage (not a query param) because a seed can carry hundreds of
 * variants — well past a safe URL length — and should not survive a tab close.
 */
const SEED_KEY = 'wp:cart-seed';

/** Sanitize to a positive-integer quantity map; drops non-finite / non-positive values. */
function sanitize(quantities: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [variantId, qty] of Object.entries(quantities)) {
    if (typeof qty === 'number' && Number.isFinite(qty) && qty > 0) {
      out[variantId] = Math.min(9999, Math.floor(qty));
    }
  }
  return out;
}

/** Stage a cart seed for the catalog to pick up on its next mount. No-op on the server. */
export function stageCartSeed(quantities: Record<string, number>): boolean {
  if (typeof window === 'undefined') return false;
  const clean = sanitize(quantities);
  if (Object.keys(clean).length === 0) return false;
  try {
    window.sessionStorage.setItem(SEED_KEY, JSON.stringify(clean));
    return true;
  } catch {
    return false;
  }
}

/** Read + clear any staged seed. Returns null when none (or on the server). */
export function consumeCartSeed(): Record<string, number> | null {
  if (typeof window === 'undefined') return null;
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(SEED_KEY);
    if (raw) window.sessionStorage.removeItem(SEED_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const clean = sanitize(parsed as Record<string, number>);
    return Object.keys(clean).length > 0 ? clean : null;
  } catch {
    return null;
  }
}
