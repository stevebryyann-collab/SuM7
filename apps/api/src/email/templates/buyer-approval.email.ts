import { button, keyValues, layout, p, type RenderedEmail } from './layout';

export interface BuyerApprovalEmailModel {
  buyerCompany: string;
  merchantName: string;
  paymentTermsLabel: string;
  pricingTierName: string | null;
  creditLimit: string | null;
  currency: string;
  portalUrl: string;
}

/** Buyer approved — congratulations, account details, portal CTA. */
export function renderBuyerApprovalEmail(model: BuyerApprovalEmailModel): RenderedEmail {
  const rows = [{ label: 'Payment Terms', value: model.paymentTermsLabel }];
  if (model.creditLimit) {
    rows.push({ label: 'Credit Limit', value: `${model.currency} ${model.creditLimit}` });
  }
  if (model.pricingTierName) {
    rows.push({ label: 'Pricing Tier', value: model.pricingTierName });
  }

  const body = [
    p(`Congratulations ${model.buyerCompany},`),
    p(`Your wholesale application with ${model.merchantName} has been approved. You can now place orders through the wholesale portal.`),
    keyValues(rows),
    button('Access Wholesale Portal', model.portalUrl),
  ].join('');

  return {
    subject: `Your wholesale application has been approved — ${model.merchantName}`,
    html: layout('Application approved', body),
  };
}
