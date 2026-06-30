'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import {
  DataTable,
  DataTableHeader,
  DataTableHeaderCell,
  DataTableBody,
  DataTableRow,
  DataTableCell,
  DataTableEmpty,
} from '@/components/shared/DataTable';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { toast } from '@/components/shared/toasts';
import {
  MarkPaidDialog,
  SendReminderDialog,
  VoidInvoiceDialog,
  type InvoiceActionTarget,
} from '@/components/merchant/InvoiceActionDialogs';
import { useDownloadInvoicePdf } from '@/hooks/useInvoiceActions';
import { ApiClientError } from '@/lib/api/error';
import { formatDate, formatMoney, daysOverdue } from '@/lib/format';
import type { InvoiceSummary } from '@/types/api';

const REMINDER_COOLDOWN_DAYS = 7;
const REMINDER_MAX = 3;
const REMINDABLE = new Set(['sent', 'viewed', 'partially_paid', 'overdue']);
const VOIDABLE = new Set(['sent', 'viewed', 'overdue']);
const COLUMN_COUNT = 10;

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

/** The "Days Overdue" cell: overdue → "X days" (danger); upcoming → "due in X days". */
function DueCell({ invoice }: { invoice: InvoiceSummary }): JSX.Element {
  if (invoice.status === 'overdue') {
    const days = daysOverdue(invoice.dueDate);
    return <span className="font-medium text-danger">{days} day{days === 1 ? '' : 's'}</span>;
  }
  if (invoice.status === 'sent' || invoice.status === 'viewed' || invoice.status === 'partially_paid') {
    const diff = differenceInCalendarDays(parseISO(invoice.dueDate), new Date());
    if (diff > 0) return <span className="text-text-secondary">due in {diff} day{diff === 1 ? '' : 's'}</span>;
    if (diff === 0) return <span className="text-text-secondary">due today</span>;
    return <span className="text-text-secondary">—</span>;
  }
  return <span className="text-text-tertiary">—</span>;
}

export interface InvoiceTableProps {
  invoices: InvoiceSummary[];
}

/**
 * Merchant invoice table ({@link DataTable}). Columns: Invoice #, Buyer, Invoice/
 * Due dates, Days Overdue, Amount, Paid, Outstanding, Status, Actions. Row click
 * opens the invoice detail; the per-row actions collapse into a single
 * {@link DropdownMenu} (View, Resend with cooldown, Mark Paid, Void, Verify
 * Integrity) to keep the dense table uncluttered. Void + Verify are owner/admin only.
 */
export function InvoiceTable({ invoices }: InvoiceTableProps): JSX.Element {
  const router = useRouter();
  const { data: session } = useSession();
  const isOwnerOrAdmin = session?.role === 'owner' || session?.role === 'admin';

  const [markPaidTarget, setMarkPaidTarget] = useState<InvoiceActionTarget | null>(null);
  const [voidTarget, setVoidTarget] = useState<InvoiceActionTarget | null>(null);
  const [reminderTarget, setReminderTarget] = useState<InvoiceActionTarget | null>(null);
  const downloadPdf = useDownloadInvoicePdf();

  const verifyIntegrity = (invoice: InvoiceSummary): void => {
    downloadPdf.mutate(invoice.id, {
      onSuccess: () => toast.success(`Integrity verified for ${invoice.invoiceNumber}`),
      onError: (error) =>
        toast.error(error instanceof ApiClientError ? error.message : 'Integrity check failed'),
    });
  };

  return (
    <>
      <DataTable>
        <DataTableHeader>
          <tr>
            <DataTableHeaderCell>Invoice #</DataTableHeaderCell>
            <DataTableHeaderCell>Buyer</DataTableHeaderCell>
            <DataTableHeaderCell>Invoice Date</DataTableHeaderCell>
            <DataTableHeaderCell>Due Date</DataTableHeaderCell>
            <DataTableHeaderCell align="right">Days Overdue</DataTableHeaderCell>
            <DataTableHeaderCell align="right">Amount</DataTableHeaderCell>
            <DataTableHeaderCell align="right">Paid</DataTableHeaderCell>
            <DataTableHeaderCell align="right">Outstanding</DataTableHeaderCell>
            <DataTableHeaderCell>Status</DataTableHeaderCell>
            <DataTableHeaderCell align="right">Actions</DataTableHeaderCell>
          </tr>
        </DataTableHeader>
        <DataTableBody>
          {invoices.length === 0 ? (
            <DataTableEmpty colSpan={COLUMN_COUNT} title="No invoices found" />
          ) : (
            invoices.map((invoice) => {
              const remind = reminderState(invoice);
              const canRemind = REMINDABLE.has(invoice.status);
              const canPay = REMINDABLE.has(invoice.status);
              const showVoid = isOwnerOrAdmin && VOIDABLE.has(invoice.status);
              return (
                <DataTableRow
                  key={invoice.id}
                  clickable
                  onClick={() => router.push(`/invoices/${invoice.id}`)}
                >
                  <DataTableCell className="font-mono text-xs text-text-secondary">
                    {invoice.invoiceNumber}
                  </DataTableCell>
                  <DataTableCell>{invoice.buyerCompanyName ?? '—'}</DataTableCell>
                  <DataTableCell className="text-text-secondary">
                    {formatDate(invoice.issuedAt ?? invoice.createdAt)}
                  </DataTableCell>
                  <DataTableCell className="text-text-secondary">{formatDate(invoice.dueDate)}</DataTableCell>
                  <DataTableCell align="right">
                    <DueCell invoice={invoice} />
                  </DataTableCell>
                  <DataTableCell align="right" className="font-mono">{formatMoney(invoice.total)}</DataTableCell>
                  <DataTableCell align="right" className="font-mono text-text-secondary">
                    {formatMoney(invoice.amountPaid)}
                  </DataTableCell>
                  <DataTableCell align="right" className="font-mono">
                    {formatMoney(outstanding(invoice))}
                  </DataTableCell>
                  <DataTableCell>
                    <StatusBadge status={invoice.status} />
                  </DataTableCell>
                  <DataTableCell align="right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end">
                      <DropdownMenu label={`Actions for ${invoice.invoiceNumber}`}>
                        <DropdownMenuItem onSelect={() => router.push(`/invoices/${invoice.id}`)}>
                          View
                        </DropdownMenuItem>
                        {canRemind ? (
                          <DropdownMenuItem
                            disabled={remind.disabled}
                            title={remind.reason}
                            onSelect={() => setReminderTarget(toTarget(invoice))}
                          >
                            Resend reminder
                          </DropdownMenuItem>
                        ) : null}
                        {canPay ? (
                          <DropdownMenuItem onSelect={() => setMarkPaidTarget(toTarget(invoice))}>
                            Mark paid
                          </DropdownMenuItem>
                        ) : null}
                        {isOwnerOrAdmin ? (
                          <DropdownMenuItem onSelect={() => verifyIntegrity(invoice)}>
                            Verify integrity
                          </DropdownMenuItem>
                        ) : null}
                        {showVoid ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem destructive onSelect={() => setVoidTarget(toTarget(invoice))}>
                              Void
                            </DropdownMenuItem>
                          </>
                        ) : null}
                      </DropdownMenu>
                    </div>
                  </DataTableCell>
                </DataTableRow>
              );
            })
          )}
        </DataTableBody>
      </DataTable>

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
