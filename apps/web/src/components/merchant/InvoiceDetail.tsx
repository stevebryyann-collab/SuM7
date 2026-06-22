'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp, Download } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { InvoiceTimeline } from '@/components/merchant/InvoiceTimeline';
import {
  MarkPaidDialog,
  SendReminderDialog,
  VoidInvoiceDialog,
  type InvoiceActionTarget,
} from '@/components/merchant/InvoiceActionDialogs';
import { ApiClientError } from '@/lib/api/error';
import { useDownloadInvoicePdf } from '@/hooks/useInvoiceActions';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import type { InvoiceDetail as InvoiceDetailType } from '@/types/api';

const UNPAID = new Set(['sent', 'viewed', 'partially_paid', 'overdue']);
const VOIDABLE = new Set(['sent', 'viewed', 'overdue']);
const REMINDABLE = new Set(['sent', 'viewed', 'partially_paid', 'overdue']);

const AUDIT_LABELS: Record<string, string> = {
  created: 'Created',
  sent: 'Sent to buyer',
  paid: 'Payment recorded',
  voided: 'Voided',
  reminder_sent: 'Reminder sent',
};

function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function actorLabel(entry: { actorLabel: string | null; actorType: string }): string {
  return entry.actorLabel ?? humanize(entry.actorType);
}

function toTarget(invoice: InvoiceDetailType): InvoiceActionTarget {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    total: invoice.total,
    amountPaid: invoice.amountPaid,
    reminderCount: invoice.reminderCount,
  };
}

export function InvoiceDetail({ invoice }: { invoice: InvoiceDetailType }): JSX.Element {
  const { data: session } = useSession();
  const canVoid = session?.role === 'owner' || session?.role === 'admin';
  const download = useDownloadInvoicePdf();

  const [markPaidOpen, setMarkPaidOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);

  const remindersLeft = Math.max(3 - invoice.reminderCount, 0);
  const showPay = UNPAID.has(invoice.status);
  const showVoid = canVoid && VOIDABLE.has(invoice.status);
  const showRemind = REMINDABLE.has(invoice.status);

  const handleDownload = (): void => {
    download.mutate(invoice.id, {
      onError: (err) => {
        if (err instanceof ApiClientError && err.code === 'INVOICE_INTEGRITY_FAILED') {
          toast.warning('Invoice PDF integrity check failed. Contact support.', { duration: Infinity });
        } else {
          toast.error(err instanceof ApiClientError ? err.message : 'Could not download the PDF');
        }
      },
    });
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <nav className="mb-1 text-xs text-gray-500">
            <Link href="/invoices" className="hover:text-gray-700">
              Invoices
            </Link>
            <span className="px-1.5">/</span>
            <span className="font-mono text-gray-700">{invoice.invoiceNumber}</span>
          </nav>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-gray-900">{invoice.invoiceNumber}</h1>
            <StatusBadge status={invoice.status} />
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Issued {formatDate(invoice.invoiceDate)} · Due {formatDate(invoice.dueDate)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Invoice preview (mirrors the PDF document) */}
        <section className="panel lg:col-span-2">
          <div className="m-4 rounded-md border border-gray-200 bg-[#fafaf8] p-6">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-base font-semibold text-gray-900">{invoice.merchantName}</div>
                <div className="mt-1 text-xs uppercase tracking-wide text-gray-500">Tax Invoice</div>
              </div>
              <div className="text-right text-xs text-gray-600">
                <div>
                  <span className="text-gray-400">Invoice </span>
                  <span className="font-mono text-gray-800">{invoice.invoiceNumber}</span>
                </div>
                <div>
                  <span className="text-gray-400">Date </span>
                  {formatDate(invoice.invoiceDate)}
                </div>
                <div>
                  <span className="text-gray-400">Due </span>
                  {formatDate(invoice.dueDate)}
                </div>
              </div>
            </div>

            <div className="mt-5 border-t border-gray-200 pt-4">
              <div className="text-label uppercase tracking-wider text-gray-400">Bill To</div>
              <div className="mt-1 text-sm text-gray-800">{invoice.buyerCompanyName ?? '—'}</div>
              {invoice.buyerAddressLines.map((line, i) => (
                <div key={i} className="text-sm text-gray-600">
                  {line}
                </div>
              ))}
              {invoice.buyerEmail ? <div className="text-sm text-gray-600">{invoice.buyerEmail}</div> : null}
            </div>

            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-300 text-left text-xs uppercase text-gray-500">
                    <th className="py-1.5 pr-2 font-medium">Description</th>
                    <th className="py-1.5 pr-2 font-medium">SKU</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Qty</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Unit</th>
                    <th className="py-1.5 text-right font-medium">Line Total</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.lineItems.map((line, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="py-1.5 pr-2 text-gray-800">
                        {line.productTitle}
                        {line.variantTitle ? <span className="text-gray-500"> — {line.variantTitle}</span> : null}
                      </td>
                      <td className="py-1.5 pr-2 font-mono text-xs text-gray-500">{line.sku ?? '—'}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{line.quantity}</td>
                      <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{formatMoney(line.unitPrice)}</td>
                      <td className="py-1.5 text-right font-mono tabular-nums">{formatMoney(line.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex justify-end">
              <div className="w-full max-w-[14rem] space-y-1 text-sm">
                <div className="flex justify-between text-gray-600">
                  <span>Subtotal</span>
                  <span className="font-mono tabular-nums">{formatMoney(invoice.subtotal)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Tax</span>
                  <span className="font-mono tabular-nums">{formatMoney(invoice.taxAmount)}</span>
                </div>
                <div className="flex justify-between border-t border-gray-900 pt-1 font-semibold text-gray-900">
                  <span>Total</span>
                  <span className="font-mono tabular-nums">{formatMoney(invoice.total)}</span>
                </div>
                {Number(invoice.amountPaid) > 0 ? (
                  <div className="flex justify-between text-gray-600">
                    <span>Paid</span>
                    <span className="font-mono tabular-nums">−{formatMoney(invoice.amountPaid)}</span>
                  </div>
                ) : null}
                {Number(invoice.outstanding) > 0 ? (
                  <div className="flex justify-between font-medium text-gray-900">
                    <span>Outstanding</span>
                    <span className="font-mono tabular-nums">{formatMoney(invoice.outstanding)}</span>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="mt-6 border border-gray-200 bg-white p-3 text-xs text-gray-600">
              <div className="text-label uppercase tracking-wider text-gray-400">Payment Instructions</div>
              <p className="mt-1">
                Please remit {formatMoney(invoice.outstanding)} by {formatDate(invoice.dueDate)}, referencing
                invoice {invoice.invoiceNumber}.
              </p>
            </div>
          </div>
        </section>

        {/* Actions + timeline */}
        <div className="space-y-4">
          <section className="panel p-4">
            <h2 className="mb-3 text-label font-medium uppercase tracking-wider text-gray-500">Status</h2>
            <InvoiceTimeline invoice={invoice} />
          </section>

          <section className="panel space-y-2 p-4">
            <Button variant="default" size="sm" className="w-full justify-center" onClick={handleDownload} disabled={download.isPending}>
              {download.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
              {download.isPending ? 'Verifying integrity…' : 'Download PDF'}
            </Button>
            {showRemind ? (
              <Button
                variant="default"
                size="sm"
                className="w-full justify-center"
                disabled={remindersLeft === 0}
                onClick={() => setReminderOpen(true)}
              >
                Resend to Buyer ({remindersLeft} of 3 remaining)
              </Button>
            ) : null}
            {showPay ? (
              <Button variant="primary" size="sm" className="w-full justify-center" onClick={() => setMarkPaidOpen(true)}>
                Mark as Paid
              </Button>
            ) : null}
            {showVoid ? (
              <Button variant="default" size="sm" className="w-full justify-center" onClick={() => setVoidOpen(true)}>
                Void Invoice
              </Button>
            ) : null}
            {invoice.shopifyOrderNumber && invoice.orderId ? (
              <Link href={`/orders/${invoice.orderId}`} className="block">
                <Button variant="default" size="sm" className="w-full justify-center">
                  View Order {invoice.shopifyOrderNumber}
                </Button>
              </Link>
            ) : null}
          </section>

          {invoice.payments.length > 0 ? (
            <section className="panel p-4">
              <h2 className="mb-2 text-label font-medium uppercase tracking-wider text-gray-500">Payment History</h2>
              <div className="space-y-2">
                {invoice.payments.map((p, i) => (
                  <div key={i} className="flex items-start justify-between gap-2 border-b border-gray-100 pb-2 text-sm last:border-0 last:pb-0">
                    <div>
                      <div className="font-mono tabular-nums text-gray-900">{formatMoney(p.amount)}</div>
                      <div className="text-xs text-gray-500">
                        {formatDate(p.paidAt)}
                        {p.reference ? ` · ${p.reference}` : ''}
                      </div>
                    </div>
                    {p.recordedBy ? <div className="text-xs text-gray-500">{p.recordedBy}</div> : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="panel p-4">
            <button
              type="button"
              className="flex w-full items-center justify-between text-label font-medium uppercase tracking-wider text-gray-500"
              onClick={() => setAuditOpen((v) => !v)}
            >
              Audit Trail
              {auditOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {auditOpen ? (
              <ol className="mt-3 space-y-2">
                {invoice.auditTrail.slice(0, 5).map((entry) => (
                  <li key={entry.id} className="flex items-start justify-between gap-2 text-sm">
                    <div>
                      <div className="text-gray-900">{AUDIT_LABELS[entry.action] ?? humanize(entry.action)}</div>
                      <div className="text-xs text-gray-500">{actorLabel(entry)}</div>
                    </div>
                    <div className="shrink-0 text-xs text-gray-500">{formatDateTime(entry.createdAt)}</div>
                  </li>
                ))}
                {invoice.auditTrail.length === 0 ? (
                  <li className="text-sm text-gray-500">No audit entries yet.</li>
                ) : null}
              </ol>
            ) : null}
          </section>
        </div>
      </div>

      <MarkPaidDialog invoice={toTarget(invoice)} open={markPaidOpen} onOpenChange={setMarkPaidOpen} />
      <VoidInvoiceDialog invoice={toTarget(invoice)} open={voidOpen} onOpenChange={setVoidOpen} />
      <SendReminderDialog invoice={toTarget(invoice)} open={reminderOpen} onOpenChange={setReminderOpen} />
    </>
  );
}
