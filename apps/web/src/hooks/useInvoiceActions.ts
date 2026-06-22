'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
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

/**
 * Send the next payment reminder for an invoice (merchant admin). The server
 * enforces max 3 reminders and a 7-day cooldown, returning the new reminder count.
 */
export function useSendReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (invoiceId: string) =>
      merchantFetch<{ sent: boolean; reminderCount: number }>(
        `/invoices/${invoiceId}/send-reminder`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: invoiceKeys.all });
    },
  });
}

/**
 * Merchant PDF download. The server verifies the stored SHA-256 first; on a
 * mismatch it throws `INVOICE_INTEGRITY_FAILED` and the download is blocked.
 * On success the short-lived presigned URL is opened in a new tab.
 */
export function useDownloadInvoicePdf() {
  return useMutation({
    mutationFn: (invoiceId: string) =>
      merchantFetch<{ url: string }>(`/invoices/${invoiceId}/pdf`, { method: 'GET' }),
    onSuccess: ({ url }) => {
      if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer');
    },
  });
}

/**
 * Download the AR-aging report as a CSV file. The API returns the CSV body as
 * text; we wrap it in a Blob and trigger a client-side download named for today.
 */
export function useExportArAging() {
  return useMutation({
    mutationFn: () => merchantFetch<string>(`/invoices/ar-aging/export`, { method: 'GET' }),
    onSuccess: (csv) => {
      if (typeof window === 'undefined') return;
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `aging_report_${format(new Date(), 'yyyy-MM-dd')}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    },
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
