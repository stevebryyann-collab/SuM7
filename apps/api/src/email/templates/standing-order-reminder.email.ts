import {
  button,
  keyValues,
  layout,
  lineItemsTable,
  p,
  type LineItemRow,
  type RenderedEmail,
} from './layout';

export interface StandingOrderReminderEmailModel {
  merchantName: string;
  buyerCompany: string;
  standingOrderName: string;
  /** Human label for the cadence: "Weekly", "Every 2 weeks", "Monthly". */
  frequencyLabel: string;
  portalUrl: string;
  manageUrl: string;
  lastOrder: { total: string; currency: string; lineItems: LineItemRow[] } | null;
}

/**
 * Reorder reminder for a buyer's standing order. Summarises the source order
 * when one is linked, offers a single accent "Place order now" button, and links
 * to the account page where reminders are managed. Same dependency-free render
 * contract as the other templates (see ./layout).
 */
export function renderStandingOrderReminderEmail(
  model: StandingOrderReminderEmailModel,
): RenderedEmail {
  const cadence = model.frequencyLabel.toLowerCase();
  const subject = `Time to place your ${model.frequencyLabel} order with ${model.merchantName}`;

  const lastOrderBlock = model.lastOrder
    ? [
        p('Here is what you ordered last time:'),
        lineItemsTable(model.lastOrder.lineItems, model.lastOrder.currency),
        keyValues([
          { label: 'Last order total', value: `${model.lastOrder.currency} ${model.lastOrder.total}` },
        ]),
      ].join('')
    : '';

  const manageLink =
    `<p style="margin:12px 0 0;color:#6B7280;font-size:12px;line-height:1.5;">` +
    `Don't need this reminder anymore? ` +
    `<a href="${encodeURI(model.manageUrl)}" style="color:#2563EB;text-decoration:none;">Manage reminders</a>.</p>`;

  const body = [
    p(
      `Hello ${model.buyerCompany}, this is your ${cadence} reorder reminder for ` +
        `${model.merchantName} ("${model.standingOrderName}").`,
    ),
    lastOrderBlock,
    button('Place order now', model.portalUrl),
    manageLink,
  ].join('');

  return { subject, html: layout(`Your ${cadence} order reminder`, body) };
}
