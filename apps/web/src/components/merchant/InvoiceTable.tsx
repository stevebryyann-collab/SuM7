'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Send } from 'lucide-react';
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
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { ApiClientError } from '@/lib/api/error';
import { formatDate, formatMoney, daysOverdue } from '@/lib/format';
import { useMarkInvoicePaid, useResendInvoice } from '@/hooks/useInvoiceActions';
import type { InvoiceSummary } from '@/types/api';

/**
 * Merchant invoice table. Columns: Invoice #, Buyer, Amount, Due Date, Status,
 * Actions. "Send Reminder" is disabled if a reminder was sent < 7 days ago (the
 * API also enforces a hard rate limit). "Mark Paid" opens a ConfirmDialog and
 * posts the full outstanding amount.
 */
const REMINDER_COOLDOWN_DAYS = 7;

function reminderDisabled(invoice: InvoiceSummary): boolean {
  if (!invoice.lastReminderAt) return false;
  const daysSince = daysOverdue(invoice.lastReminderAt);
  // daysOverdue counts days since the timestamp; reuse it for "days since sent".
  return daysSince < REMINDER_COOLDOWN_DAYS;
}

function outstanding(invoice: InvoiceSummary): string {
  const total = Number(invoice.total) || 0;
  const paid = Number(invoice.amountPaid) || 0;
  // Display only — server recomputes with Decimal on mark-paid.
  return Math.max(total - paid, 0).toFixed(2);
}

export interface InvoiceTableProps {
  invoices: InvoiceSummary[];
}

export function InvoiceTable({ invoices }: InvoiceTableProps): JSX.Element {
  const [markPaidTarget, setMarkPaidTarget] = useState<InvoiceSummary | null>(null);
  const markPaid = useMarkInvoicePaid();
  const resend = useResendInvoice();

  const handleResend = (invoice: InvoiceSummary): void => {
    resend.mutate(invoice.id, {
      onSuccess: () => toast.success(`Reminder sent for ${invoice.invoiceNumber}`),
      onError: (error) =>
        toast.error(error instanceof ApiClientError ? error.message : 'Failed to send reminder'),
    });
  };

  const handleConfirmPaid = (): void => {
    if (!markPaidTarget) return;
    const target = markPaidTarget;
    markPaid.mutate(
      { invoiceId: target.id, amount: outstanding(target) },
      {
        onSuccess: () => {
          toast.success(`${target.invoiceNumber} marked paid`);
          setMarkPaidTarget(null);
        },
        onError: (error) =>
          toast.error(error instanceof ApiClientError ? error.message : 'Failed to mark paid'),
      },
    );
  };

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Invoice #</TableHead>
            <TableHead>Buyer</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Due Date</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-sm text-gray-500">
                No invoices found.
              </TableCell>
            </TableRow>
          ) : (
            invoices.map((invoice) => {
              const isResendingThis = resend.isPending && resend.variables === invoice.id;
              const settled = invoice.status === 'paid' || invoice.status === 'void';
              return (
                <TableRow key={invoice.id}>
                  <TableCell className="font-mono text-xs text-gray-700">{invoice.invoiceNumber}</TableCell>
                  <TableCell>{invoice.buyerCompanyName ?? '—'}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatMoney(invoice.total)}</TableCell>
                  <TableCell className="text-gray-600">{formatDate(invoice.dueDate)}</TableCell>
                  <TableCell>
                    <StatusBadge status={invoice.status} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="default"
                        size="sm"
                        disabled={settled || reminderDisabled(invoice) || isResendingThis}
                        onClick={() => handleResend(invoice)}
                        title={
                          reminderDisabled(invoice)
                            ? `A reminder was sent within the last ${REMINDER_COOLDOWN_DAYS} days`
                            : 'Send a payment reminder'
                        }
                      >
                        {isResendingThis ? <Spinner className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
                        Send Reminder
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={settled}
                        onClick={() => setMarkPaidTarget(invoice)}
                      >
                        Mark Paid
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      <ConfirmDialog
        open={markPaidTarget !== null}
        onOpenChange={(open) => !open && setMarkPaidTarget(null)}
        title="Mark invoice as paid?"
        description={
          markPaidTarget ? (
            <span>
              Record full payment of{' '}
              <span className="font-medium text-gray-900">{formatMoney(outstanding(markPaidTarget))}</span> for{' '}
              <span className="font-mono">{markPaidTarget.invoiceNumber}</span>. This writes to the audit log
              and cannot be undone.
            </span>
          ) : null
        }
        confirmLabel="Mark Paid"
        isLoading={markPaid.isPending}
        onConfirm={handleConfirmPaid}
      />
    </>
  );
}
