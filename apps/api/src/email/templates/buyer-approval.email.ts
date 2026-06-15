import { button, keyValues, layout, p, type RenderedEmail } from './layout';

export interface BuyerApprovalEmailModel {
  buyerCompany: string;
  merchantName: string;
  paymentTermsLabel: string;
  creditLimit: string | null;
  currency: string;
  portalUrl: string;
}

/** Buyer approved — congratulations, terms, optional credit limit, portal link. */
export function renderBuyerApprovalEmail(model: BuyerApprovalEmailModel): RenderedEmail {
  const rows = [{ label: 'Payment Terms', value: model.paymentTermsLabel }];
  if (model.creditLimit) {
    rows.push({ label: 'Credit Limit', value: `${model.currency} ${model.creditLimit}` });
  }

  const body = [
    p(`Congratulations ${model.buyerCompany},`),
    p(`Your wholesale account with ${model.merchantName} has been approved. You can now place orders through the buyer portal.`),
    keyValues(rows),
    button('Go to your portal', model.portalUrl),
  ].join('');

  return {
    subject: `You're approved to order with ${model.merchantName}`,
    html: layout('Account approved', body),
  };
}
