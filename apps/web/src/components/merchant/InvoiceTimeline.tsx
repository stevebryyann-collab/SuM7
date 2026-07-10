'use client';

import { Check, Circle, CircleDot } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import type { InvoiceDetail } from '@/types/api';

type StepTone = 'done' | 'current' | 'danger' | 'pending';

interface Step {
  label: string;
  detail: string;
  tone: StepTone;
}

function buildSteps(invoice: InvoiceDetail): Step[] {
  const isPaid = invoice.status === 'paid';
  const isVoid = invoice.status === 'void';
  const isOverdue = invoice.status === 'overdue';

  const created: Step = { label: 'Created', detail: formatDate(invoice.createdAt), tone: 'done' };

  const sent: Step = invoice.sentAt
    ? { label: 'Sent', detail: formatDate(invoice.sentAt), tone: 'done' }
    : { label: 'Sent', detail: 'Not yet sent', tone: 'pending' };

  const viewed: Step = invoice.firstViewedAt
    ? { label: 'Viewed', detail: formatDate(invoice.firstViewedAt), tone: 'done' }
    : { label: 'Viewed', detail: 'Not yet viewed', tone: 'pending' };

  const due: Step = isPaid
    ? { label: 'Payment due', detail: formatDate(invoice.dueDate), tone: 'done' }
    : isOverdue
      ? { label: 'Payment overdue', detail: `Was due ${formatDate(invoice.dueDate)}`, tone: 'danger' }
      : { label: 'Payment due', detail: formatDate(invoice.dueDate), tone: 'current' };

  const paid: Step = isPaid
    ? { label: 'Paid', detail: invoice.paidAt ? formatDate(invoice.paidAt) : 'Paid in full', tone: 'done' }
    : invoice.status === 'partially_paid'
      ? { label: 'Partially paid', detail: 'Balance outstanding', tone: 'current' }
      : { label: 'Paid', detail: 'Awaiting payment', tone: 'pending' };

  if (isVoid) {
    return [created, sent, { label: 'Voided', detail: 'Invoice voided', tone: 'danger' }];
  }
  return [created, sent, viewed, due, paid];
}

function StepIcon({ tone }: { tone: StepTone }): JSX.Element {
  if (tone === 'done') return <Check className="h-4 w-4 text-green-600" />;
  if (tone === 'danger') return <CircleDot className="h-4 w-4 text-red-600" />;
  if (tone === 'current') return <CircleDot className="h-4 w-4 text-accent" />;
  return <Circle className="h-4 w-4 text-text-tertiary" />;
}

/** Vertical status timeline rendered on the invoice detail actions panel. */
export function InvoiceTimeline({ invoice }: { invoice: InvoiceDetail }): JSX.Element {
  const steps = buildSteps(invoice);
  return (
    <ol className="space-y-3">
      {steps.map((step, i) => (
        <li key={`${step.label}-${i}`} className="flex items-start gap-2.5">
          <span className="mt-0.5">
            <StepIcon tone={step.tone} />
          </span>
          <div className="min-w-0">
            <div
              className={cn(
                'text-sm font-medium',
                step.tone === 'pending' ? 'text-text-tertiary' : step.tone === 'danger' ? 'text-red-700' : 'text-text-primary',
              )}
            >
              {step.label}
            </div>
            <div className="text-xs text-text-secondary">{step.detail}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
