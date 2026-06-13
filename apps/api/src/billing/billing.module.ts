import { Module } from '@nestjs/common';

/**
 * Hybrid billing: flat Stripe subscription + metered GMV usage records with
 * per-tier free thresholds. Also maintains the merchant:tier:* cache the
 * rate-limit guard reads. Bootable scaffold — services added by the Billing task.
 */
@Module({})
export class BillingModule {}
