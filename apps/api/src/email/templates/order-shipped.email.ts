import { button, keyValues, layout, muted, p, type KeyValue, type RenderedEmail } from './layout';

export interface OrderShippedEmailModel {
  merchantName: string;
  orderNumber: string;
  carrierName: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
}

/**
 * "Your order has shipped" notification. Leads with the order number, lists the
 * carrier + tracking number, and offers a single accent "Track your order"
 * button when a tracking URL is known; otherwise the tracking number is shown as
 * plain text. Same dependency-free render contract as the other templates (see
 * ./layout for why react-email is not used here).
 */
export function renderOrderShippedEmail(model: OrderShippedEmailModel): RenderedEmail {
  const subject = `Your order ${model.orderNumber} has shipped`;

  const rows: KeyValue[] = [
    { label: 'Merchant', value: model.merchantName },
    { label: 'Order', value: model.orderNumber },
  ];
  if (model.carrierName) rows.push({ label: 'Carrier', value: model.carrierName });
  if (model.trackingNumber) rows.push({ label: 'Tracking number', value: model.trackingNumber });

  const cta = model.trackingUrl
    ? button('Track your order', model.trackingUrl)
    : model.trackingNumber
      ? p(`Tracking number: ${model.trackingNumber}`)
      : '';

  const body = [
    p(`Good news — your order ${model.orderNumber} from ${model.merchantName} has been dispatched!`),
    keyValues(rows),
    cta,
    muted(`Questions about your shipment? Reply to this email and ${model.merchantName} will help.`),
  ].join('');

  return { subject, html: layout(`Order ${model.orderNumber} is on its way`, body) };
}
