'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { InvoiceStatus } from '@b2b/shared/types';
import type { MarkPaidInput } from '@b2b/shared/schemas';
import { merchantFetch } from '@/lib/api/merchant';
import { buyerFetch } from '@/lib/api/buyer';
import { invoiceKeys } from './useInvoices';
import { merchantDashboardKeys } from './useMerchantDashboard';

/** Record a (partial) payment against an invoice (merchant admin). */
export function useMarkInvoicePaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MarkPaidInput) =>
      merchantFetch<{ id: string; status: InvoiceStatus; amountPaid: string }>(
        `/invoices/${input.invoiceId}/mark-paid`,
        { method: 'PATCH', body: input },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: invoiceKeys.all });
      void qc.invalidateQueries({ queryKey: merchantDashboardKeys.all });
    },
  });
}

/** Void an unpaid invoice with a required reason (merchant admin). */
export function useVoidInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ invoiceId, reason }: { invoiceId: string; reason: string }) =>
      merchantFetch<{ id: string; status: InvoiceStatus }>(`/invoices/${invoiceId}/void`, {
        method: 'PATCH',
        body: { reason },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: invoiceKeys.all });
      void qc.invalidateQueries({ queryKey: merchantDashboardKeys.all });
    },
  });
}

/** Re-send the invoice email (rate-limited server-side to 1 / 5 min). */
export function useResendInvoice() {
  return useMutation({
    mutationFn: (invoiceId: string) =>
      merchantFetch<{ sent: boolean }>(`/invoices/${invoiceId}/resend`, { method: 'POST' }),
  });
}

/**
 * Fetch a presigned PDF download URL for one of the buyer's own invoices, then
 * open it. The presigned URL is short-lived (1h) and ownership-checked server-side.
 */
export function useDownloadInvoice() {
  return useMutation({
    mutationFn: (invoiceId: string) =>
      buyerFetch<{ url: string }>(`/buyer/invoices/${invoiceId}/download`, { method: 'GET' }),
    onSuccess: ({ url }) => {
      if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer');
    },
  });
}
