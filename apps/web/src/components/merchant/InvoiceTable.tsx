'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/shared/StatusBadge';
import {
  MarkPaidDialog,
  SendReminderDialog,
  VoidInvoiceDialog,
  type InvoiceActionTarget,
} from '@/components/merchant/InvoiceActionDialogs';
import { formatDate, formatMoney, daysOverdue } from '@/lib/format';
import type { InvoiceSummary } from '@/types/api';

const REMINDER_COOLDOWN_DAYS = 7;
const REMINDER_MAX = 3;
const REMINDABLE = new Set(['sent', 'viewed', 'partially_paid', 'overdue']);
const VOIDABLE = new Set(['sent', 'viewed', 'overdue']);

function toTarget(invoice: InvoiceSummary): InvoiceActionTarget {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    total: invoice.total,
    amountPaid: invoice.amountPaid,
    reminderCount: invoice.reminderCount,
  };
}

function outstanding(invoice: InvoiceSummary): string {
  return Math.max(Number(invoice.total) - Number(invoice.amountPaid), 0).toFixed(2);
}

function reminderState(invoice: InvoiceSummary): { disabled: boolean; reason: string } {
  if (invoice.reminderCount >= REMINDER_MAX) {
    return { disabled: true, reason: 'All 3 reminders have been sent' };
  }
  if (invoice.lastReminderAt && daysOverdue(invoice.lastReminderAt) < REMINDER_COOLDOWN_DAYS) {
    return { disabled: true, reason: `A reminder was sent within the last ${REMINDER_COOLDOWN_DAYS} days` };
  }
  return { disabled: false, reason: 'Send a payment reminder' };
}

export interface InvoiceTableProps {
  invoices: InvoiceSummary[];
}

/**
 * Merchant invoice table. Columns: Invoice #, Buyer, Invoice/Due dates, Amount,
 * Paid, Outstanding, Status, Actions. Row click opens the invoice detail; the
 * status-driven actions (Send Reminder with cooldown + remaining count, Mark
 * Paid, Void) open their respective dialogs. Void is owner/admin only.
 */
export function InvoiceTable({ invoices }: InvoiceTableProps): JSX.Element {
  const router = useRouter();
  const { data: session } = useSession();
  const canVoid = session?.role === 'owner' || session?.role === 'admin';

  const [markPaidTarget, setMarkPaidTarget] = useState<InvoiceActionTarget | null>(null);
  const [voidTarget, setVoidTarget] = useState<InvoiceActionTarget | null>(null);
  const [reminderTarget, setReminderTarget] = useState<InvoiceActionTarget | null>(null);

  return (
    <>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice #</TableHead>
              <TableHead>Buyer</TableHead>
              <TableHead>Invoice Date</TableHead>
              <TableHead>Due Date</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-sm text-gray-500">
                  No invoices found.
                </TableCell>
              </TableRow>
            ) : (
              invoices.map((invoice) => {
                const remind = reminderState(invoice);
                const canRemind = REMINDABLE.has(invoice.status);
                const canPay = REMINDABLE.has(invoice.status);
                const showVoid = canVoid && VOIDABLE.has(invoice.status);
                return (
                  <TableRow
                    key={invoice.id}
                    clickable
                    className="cursor-pointer"
                    onClick={() => router.push(`/invoices/${invoice.id}`)}
                  >
                    <TableCell className="font-mono text-xs text-gray-700">{invoice.invoiceNumber}</TableCell>
                    <TableCell>{invoice.buyerCompanyName ?? '—'}</TableCell>
                    <TableCell className="text-gray-600">
                      {formatDate(invoice.issuedAt ?? invoice.createdAt)}
                    </TableCell>
                    <TableCell className="text-gray-600">{formatDate(invoice.dueDate)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatMoney(invoice.total)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-gray-600">
                      {formatMoney(invoice.amountPaid)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatMoney(outstanding(invoice))}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={invoice.status} />
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-2">
                        {canRemind ? (
                          <Button
                            variant="default"
                            size="sm"
                            disabled={remind.disabled}
                            title={remind.reason}
                            onClick={() => setReminderTarget(toTarget(invoice))}
                          >
                            Send Reminder
                          </Button>
                        ) : null}
                        {canPay ? (
                          <Button variant="primary" size="sm" onClick={() => setMarkPaidTarget(toTarget(invoice))}>
                            Mark Paid
                          </Button>
                        ) : null}
                        {showVoid ? (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => setVoidTarget(toTarget(invoice))}
                          >
                            Void
                          </Button>
                        ) : null}
                        {!canRemind && !canPay && !showVoid ? (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => router.push(`/invoices/${invoice.id}`)}
                          >
                            View
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <MarkPaidDialog
        invoice={markPaidTarget}
        open={markPaidTarget !== null}
        onOpenChange={(open) => !open && setMarkPaidTarget(null)}
      />
      <VoidInvoiceDialog
        invoice={voidTarget}
        open={voidTarget !== null}
        onOpenChange={(open) => !open && setVoidTarget(null)}
      />
      <SendReminderDialog
        invoice={reminderTarget}
        open={reminderTarget !== null}
        onOpenChange={(open) => !open && setReminderTarget(null)}
      />
    </>
  );
}
