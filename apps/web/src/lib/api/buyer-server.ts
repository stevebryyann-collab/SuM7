import { cookies } from 'next/headers';
import { API_BASE_URL } from '../env';
import type { MerchantContextDto } from '@b2b/shared/types';

// Importing `next/headers` makes this module server-only by construction: any
// attempt to import it from a Client Component throws at build time. No need for
// the `server-only` package.

/**
 * Server-side resolution of the buyer's white-label merchant branding.
 *
 * Buyer pages are rendered as server components for the public shell (login /
 * signup / apply headings). They cannot use the client `buyerFetch` (no Clerk
 * hook, no `document.cookie`), so this reads the signed `__merchant_ctx` cookie
 * via `next/headers` and forwards it to the API as `X-Merchant-Context`.
 *
 * Returns `null` (never throws) when the context cookie is missing or the API is
 * unreachable, so a branding lookup can never break the auth pages — callers
 * fall back to a neutral "Wholesale" label.
 */
export async function getMerchantContextServer(): Promise<MerchantContextDto | null> {
  const ctx = cookies().get('__merchant_ctx')?.value;
  if (!ctx) return null;

  try {
    const response = await fetch(`${API_BASE_URL.replace(/\/$/, '')}/buyer/merchant-context`, {
      method: 'GET',
      headers: { Accept: 'application/json', 'X-Merchant-Context': ctx },
      cache: 'no-store',
    });
    if (!response.ok) return null;
    return (await response.json()) as MerchantContextDto;
  } catch {
    return null;
  }
}
