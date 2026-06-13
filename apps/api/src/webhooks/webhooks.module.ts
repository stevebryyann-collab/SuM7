import { Module } from '@nestjs/common';

/**
 * Inbound webhook ingestion (Shopify HMAC, Stripe, Resolve). Routes under
 * /webhooks/* receive the raw request body (preserved in main.ts) for signature
 * verification and are exempt from the rate-limit guard. Bootable scaffold —
 * controllers/processors added by the Webhooks feature task.
 */
@Module({})
export class WebhooksModule {}
