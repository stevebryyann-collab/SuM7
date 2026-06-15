import { button, keyValues, layout, p, type RenderedEmail } from './layout';

export interface MerchantNewApplicationEmailModel {
  applicantCompany: string;
  businessType: string | null;
  estimatedMonthlyOrder: string | null;
  reviewUrl: string;
}

/** Alert a merchant to a new buyer application awaiting review. */
export function renderMerchantNewApplicationEmail(
  model: MerchantNewApplicationEmailModel,
): RenderedEmail {
  const rows = [{ label: 'Company', value: model.applicantCompany }];
  if (model.businessType) rows.push({ label: 'Business Type', value: model.businessType });
  if (model.estimatedMonthlyOrder) {
    rows.push({ label: 'Est. Monthly Order', value: model.estimatedMonthlyOrder });
  }

  const body = [
    p('A new buyer has applied for a wholesale account and is awaiting your review.'),
    keyValues(rows),
    button('Review application', model.reviewUrl),
  ].join('');

  return {
    subject: `New wholesale application: ${model.applicantCompany}`,
    html: layout('New buyer application', body),
  };
}
