import { button, keyValues, layout, muted, p, type RenderedEmail } from './layout';

export type ReminderCount = 1 | 2 | 3;

export interface PaymentReminderEmailModel {
  invoiceNumber: string;
  merchantName: string;
  merchantEmail: string;
  outstandingAmount: string;
  currency: string;
  dueDate: string;
  daysOverdue: number;
  reminderCount: ReminderCount;
  portalUrl: string | null;
}

/**
 * Payment reminder whose tone escalates with `reminderCount`:
 *   1 friendly · 2 firm · 3 urgent (final notice).
 */
export function renderPaymentReminderEmail(model: PaymentReminderEmailModel): RenderedEmail {
  let heading: string;
  let lead: string;
  let subject: string;

  if (model.reminderCount === 1) {
    heading = `Payment reminder · ${model.invoiceNumber}`;
    subject = `Friendly reminder: invoice ${model.invoiceNumber}`;
    lead = `This is a friendly reminder that invoice #${model.invoiceNumber} for ${model.currency} ${model.outstandingAmount} was due on ${model.dueDate}. Please arrange payment at your convenience.`;
  } else if (model.reminderCount === 2) {
    heading = `Payment overdue · ${model.invoiceNumber}`;
    subject = `Overdue: invoice ${model.invoiceNumber} (${model.daysOverdue} days)`;
    lead = `Your invoice #${model.invoiceNumber} is now ${model.daysOverdue} days overdue. Please arrange payment immediately.`;
  } else {
    heading = `FINAL NOTICE · ${model.invoiceNumber}`;
    subject = `FINAL NOTICE: invoice ${model.invoiceNumber} (${model.daysOverdue} days overdue)`;
    lead = `FINAL NOTICE — Invoice #${model.invoiceNumber} (${model.daysOverdue} days overdue). Please contact ${model.merchantEmail} immediately to avoid service interruption.`;
  }

  const body = [
    p(lead),
    keyValues([
      { label: 'Invoice', value: model.invoiceNumber },
      { label: 'Outstanding', value: `${model.currency} ${model.outstandingAmount}` },
      { label: 'Due Date', value: model.dueDate },
    ]),
    model.portalUrl ? button('View invoice', model.portalUrl) : '',
    muted(`Questions or a dispute about this invoice? Contact ${model.merchantEmail}.`),
  ].join('');

  return { subject, html: layout(heading, body) };
}
