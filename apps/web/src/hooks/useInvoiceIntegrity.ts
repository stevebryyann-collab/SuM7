'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { buyerFetch } from '@/lib/api/buyer';

export interface InvoiceIntegrity {
  /** True once the invoice PDF has a stored SHA-256 (the "verified" indicator). */
  hasIntegrityHash: boolean;
  invoiceNumber: string;
}

/**
 * Fast presence check for a buyer invoice's cryptographic seal, powering the
 * "✓ Verified" / "⚠ Verification pending" indicator on the download page. The API
 * only reports whether a hash exists (a presence check, not a full re-verify) and
 * caches it 1h server-side — safe to poll and cheap to render.
 */
export function useInvoiceIntegrity(invoiceId: string | undefined): UseQueryResult<InvoiceIntegrity, Error> {
  return useQuery({
    queryKey: ['buyer-invoice-integrity', invoiceId] as const,
    queryFn: ({ signal }) =>
      buyerFetch<InvoiceIntegrity>(`/buyer/invoices/${invoiceId}/integrity-status`, { signal }),
    enabled: Boolean(invoiceId),
    staleTime: 3_600_000,
  });
}
