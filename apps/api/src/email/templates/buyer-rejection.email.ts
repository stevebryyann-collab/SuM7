import { layout, muted, p, quote, type RenderedEmail } from './layout';

export interface BuyerRejectionEmailModel {
  buyerCompany: string;
  merchantName: string;
  merchantEmail: string;
  rejectionReason: string | null;
}

/** Professional decline — optional reason quoted, invite to make contact. */
export function renderBuyerRejectionEmail(model: BuyerRejectionEmailModel): RenderedEmail {
  const body = [
    p(`Hello ${model.buyerCompany},`),
    p(`Thank you for your interest in a wholesale account with ${model.merchantName}. After reviewing your application, we are unable to approve it at this time.`),
    model.rejectionReason ? quote(model.rejectionReason) : '',
    muted(`If you believe this was a mistake, contact ${model.merchantEmail} and we'll be glad to take another look.`),
  ].join('');

  return {
    subject: `Update on your application to ${model.merchantName}`,
    html: layout('Application update', body),
  };
}
