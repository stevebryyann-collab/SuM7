import type { Job } from 'bullmq';
import type { PaymentTerms } from '@b2b/shared';

/** The minimal job payload every webhook worker receives. */
export interface WebhookJobData {
  webhookEventId: string;
  shopifyDomain: string;
  topic: string;
}

/** Payload for the scheduled merchant data-purge job (90 days post-uninstall). */
export interface MerchantPurgeJobData {
  merchantId: string;
}

/** Net-terms → days mapping for due-date computation. */
export const PAYMENT_TERMS_DAYS: Record<PaymentTerms, number> = {
  immediate: 0,
  net15: 15,
  net30: 30,
  net60: 60,
  net90: 90,
};

/** Net-terms → human label for invoices and emails. */
export const PAYMENT_TERMS_LABELS: Record<PaymentTerms, string> = {
  immediate: 'Due on receipt',
  net15: 'Net 15',
  net30: 'Net 30',
  net60: 'Net 60',
  net90: 'Net 90',
};

/** True when BullMQ has exhausted every configured retry for this job. */
export function isFinalAttempt(job: Job): boolean {
  return job.attemptsMade >= (job.opts.attempts ?? 1);
}

/** Coerce a Shopify numeric/string id from a JSON payload to a string, or null. */
export function asShopifyId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.length > 0) return value;
  return null;
}
