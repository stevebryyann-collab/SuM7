import {
  button,
  keyValues,
  layout,
  lineItemsTable,
  muted,
  p,
  type LineItemRow,
  type RenderedEmail,
} from './layout';

export interface InvoiceEmailModel {
  invoiceNumber: string;
  merchantName: string;
  buyerCompany: string;
  total: string;
  currency: string;
  dueDate: string;
  paymentTerms: string;
  presignedUrl: string | null;
  lineItems: LineItemRow[];
}

/** "Your invoice is ready" — invoice meta, total, download button, summary. */
export function renderInvoiceEmail(model: InvoiceEmailModel): RenderedEmail {
  const body = [
    p(`Hello ${model.buyerCompany},`),
    p(`A new invoice from ${model.merchantName} is ready.`),
    keyValues([
      { label: 'Invoice', value: model.invoiceNumber },
      { label: 'Total', value: `${model.currency} ${model.total}` },
      { label: 'Due Date', value: model.dueDate },
      { label: 'Payment Terms', value: model.paymentTerms },
    ]),
    lineItemsTable(model.lineItems, model.currency, 10),
    model.presignedUrl
      ? button('Download Invoice PDF', model.presignedUrl) + muted('This link expires in 1 hour.')
      : p('Your invoice PDF is available in your buyer portal.'),
  ].join('');

  return {
    subject: `Invoice ${model.invoiceNumber} from ${model.merchantName}`,
    html: layout(`Invoice ${model.invoiceNumber}`, body),
  };
}
