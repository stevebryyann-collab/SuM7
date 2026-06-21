'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { ApiClientError } from '@/lib/api/error';
import { formatMoney } from '@/lib/format';
import { useMarkInvoicePaid, useSendReminder, useVoidInvoice } from '@/hooks/useInvoiceActions';

/** The minimal invoice shape every action dialog needs. */
export interface InvoiceActionTarget {
  id: string;
  invoiceNumber: string;
  total: string;
  amountPaid: string;
  reminderCount: number;
}

function outstandingOf(invoice: Pick<InvoiceActionTarget, 'total' | 'amountPaid'>): string {
  return Math.max(Number(invoice.total) - Number(invoice.amountPaid), 0).toFixed(2);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Mark paid (amount / reference / date form) ────────────────────────────

export function MarkPaidDialog({
  invoice,
  open,
  onOpenChange,
  onDone,
}: {
  invoice: InvoiceActionTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}): JSX.Element {
  const markPaid = useMarkInvoicePaid();
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(todayIso());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && invoice) {
      setAmount(outstandingOf(invoice));
      setReference('');
      setDate(todayIso());
      setError(null);
    }
  }, [open, invoice]);

  const submit = (): void => {
    if (!invoice) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError('Enter a payment amount greater than zero.');
      return;
    }
    setError(null);
    markPaid.mutate(
      {
        invoiceId: invoice.id,
        amount: value.toFixed(2),
        reference: reference.trim() || undefined,
        paidAt: new Date(`${date}T12:00:00`).toISOString(),
      },
      {
        onSuccess: () => {
          toast.success(`Payment recorded for ${invoice.invoiceNumber}`);
          onOpenChange(false);
          onDone?.();
        },
        onError: (err) =>
          setError(err instanceof ApiClientError ? err.message : 'Failed to record payment'),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a payment</DialogTitle>
          <DialogDescription>
            {invoice ? (
              <>
                Outstanding on <span className="font-mono">{invoice.invoiceNumber}</span>:{' '}
                <span className="font-medium text-gray-900">{formatMoney(outstandingOf(invoice))}</span>
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="mp-amount">Amount received</Label>
            <Input
              id="mp-amount"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mp-ref">Payment reference (optional)</Label>
            <Input
              id="mp-ref"
              placeholder="e.g. ACH-00123"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mp-date">Payment date</Label>
            <Input id="mp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="default" size="sm" onClick={() => onOpenChange(false)} disabled={markPaid.isPending}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={markPaid.isPending}>
            {markPaid.isPending ? <Spinner className="h-3.5 w-3.5" /> : null}
            Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Void (reason + warning) ───────────────────────────────────────────────

export function VoidInvoiceDialog({
  invoice,
  open,
  onOpenChange,
  onDone,
}: {
  invoice: InvoiceActionTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}): JSX.Element {
  const voidInvoice = useVoidInvoice();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason('');
      setError(null);
    }
  }, [open]);

  const submit = (): void => {
    if (!invoice) return;
    if (reason.trim().length === 0) {
      setError('A reason is required and will be recorded in the audit log.');
      return;
    }
    setError(null);
    voidInvoice.mutate(
      { invoiceId: invoice.id, reason: reason.trim() },
      {
        onSuccess: () => {
          toast.success(`${invoice.invoiceNumber} voided`);
          onOpenChange(false);
          onDone?.();
        },
        onError: (err) =>
          setError(err instanceof ApiClientError ? err.message : 'Failed to void invoice'),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Void invoice {invoice?.invoiceNumber}</DialogTitle>
          <DialogDescription>
            This cannot be undone. The invoice record is retained for financial compliance, and the
            buyer is notified by email.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="void-reason">Reason</Label>
            <Textarea
              id="void-reason"
              rows={3}
              placeholder="Why is this invoice being voided?"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="default" size="sm" onClick={() => onOpenChange(false)} disabled={voidInvoice.isPending}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={submit} disabled={voidInvoice.isPending}>
            {voidInvoice.isPending ? <Spinner className="h-3.5 w-3.5" /> : null}
            Void invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Send reminder (confirm with remaining count) ──────────────────────────

export function SendReminderDialog({
  invoice,
  open,
  onOpenChange,
  onDone,
}: {
  invoice: InvoiceActionTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}): JSX.Element {
  const sendReminder = useSendReminder();
  const nextCount = (invoice?.reminderCount ?? 0) + 1;

  const confirm = (): void => {
    if (!invoice) return;
    sendReminder.mutate(invoice.id, {
      onSuccess: (result) => {
        toast.success(
          result.sent
            ? `Reminder ${result.reminderCount} of 3 sent for ${invoice.invoiceNumber}`
            : 'Reminder could not be delivered — please try again',
        );
        onOpenChange(false);
        onDone?.();
      },
      onError: (err) => {
        onOpenChange(false);
        toast.error(err instanceof ApiClientError ? err.message : 'Failed to send reminder');
      },
    });
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Send payment reminder?"
      description={
        invoice ? (
          <span>
            They&apos;ll receive reminder #{nextCount} of 3 by email for{' '}
            <span className="font-mono">{invoice.invoiceNumber}</span>.
          </span>
        ) : null
      }
      confirmLabel="Send reminder"
      isLoading={sendReminder.isPending}
      onConfirm={confirm}
    />
  );
}
