'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Download, Loader2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { toast } from '@/components/shared/toasts';
import { useInvoices } from '@/hooks/useInvoices';
import { useBuyerInvoicePdfUrl } from '@/hooks/useInvoiceActions';
import { useInvoiceIntegrity } from '@/hooks/useInvoiceIntegrity';
import { ApiClientError } from '@/lib/api/error';
import { cn } from '@/lib/cn';
import { formatDate, formatMoney } from '@/lib/format';
import type { InvoiceSummary } from '@/types/api';

/**
 * Buyer invoice download page. The download feels instant and trustworthy: the
 * button switches to a "Preparing invoice…" spinner, fetches a short-lived
 * presigned URL, and drives a hidden `<a download>` so the file saves named for
 * the invoice. A lightweight integrity indicator confirms the PDF is
 * cryptographically sealed. Invoice metadata is read from the already-loaded
 * invoices list cache; the integrity endpoint also returns the number, so a deep
 * link still renders a correct heading.
 */
export default function BuyerInvoiceDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const invoicesQuery = useInvoices({ mode: 'buyer' });
  const invoice = useMemo<InvoiceSummary | undefined>(() => {
    const all = (invoicesQuery.data?.pages ?? []).flatMap((page) => page.data);
    return all.find((inv) => inv.id === id);
  }, [invoicesQuery.data, id]);

  const integrity = useInvoiceIntegrity(id);
  const download = useBuyerInvoicePdfUrl();

  const invoiceNumber = invoice?.invoiceNumber ?? integrity.data?.invoiceNumber ?? '';
  const verified = integrity.data?.hasIntegrityHash === true;

  const startDownload = (): void => {
    if (!id) return;
    download.mutate(id, {
      onSuccess: ({ url }) => {
        if (typeof document === 'undefined') return;
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${invoiceNumber || 'invoice'}.pdf`;
        anchor.rel = 'noopener noreferrer';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      },
      onError: (error) =>
        toast.error(
          error instanceof ApiClientError ? error.message : 'Download failed. Please try again.',
        ),
    });
  };

  return (
    <>
      <Link
        href="/portal/invoices"
        className="mb-4 inline-flex items-center gap-1 text-sm text-accent hover:underline"
      >
        <ArrowLeft className="h-4 w-4" /> Back to invoices
      </Link>

      <PageHeader
        title={`Invoice ${invoiceNumber}`.trim()}
        description="Download your invoice PDF."
        actions={invoice ? <StatusBadge status={invoice.status} /> : undefined}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {invoice ? (
          <section className="panel p-5">
            <h2 className="mb-3 text-sm font-medium text-text-primary">Summary</h2>
            <dl className="space-y-1.5 text-sm">
              <Row label="Invoice number" value={invoiceNumber} mono />
              <Row label="Amount due" value={formatMoney(invoice.total)} mono strong />
              <Row label="Amount paid" value={formatMoney(invoice.amountPaid)} mono />
              <Row label="Due date" value={formatDate(invoice.dueDate)} />
            </dl>
          </section>
        ) : null}

        <section className="panel flex flex-col items-start gap-3 p-5">
          <h2 className="text-sm font-medium text-text-primary">Download</h2>
          <Button variant="primary" onClick={startDownload} disabled={download.isPending}>
            {download.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {download.isPending ? 'Preparing invoice…' : 'Download PDF'}
          </Button>
          <p className="text-xs text-text-tertiary">
            Your download should start automatically. Link expires in 1 hour.
          </p>

          {integrity.isLoading ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-text-tertiary">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking integrity…
            </span>
          ) : verified ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-success">
              <ShieldCheck className="h-3.5 w-3.5" /> Verified
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs text-warning">
              <ShieldAlert className="h-3.5 w-3.5" /> Verification pending
            </span>
          )}
        </section>
      </div>
    </>
  );
}

function Row({
  label,
  value,
  mono,
  strong,
}: {
  label: string;
  value: string;
  mono?: boolean;
  strong?: boolean;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-text-secondary">{label}</dt>
      <dd className={cn('text-text-primary', mono && 'font-mono tabular-nums', strong && 'font-semibold')}>
        {value}
      </dd>
    </div>
  );
}
