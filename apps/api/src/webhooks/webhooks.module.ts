import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhookHmacGuard } from './webhook-hmac.guard';

/**
 * Inbound Shopify webhook ingestion. Routes under /webhooks/* receive the raw
 * request body (preserved in main.ts) for HMAC verification and are exempt from
 * the rate-limit guard. The WebhookHmacGuard performs all three verification
 * checks; the controller records + enqueues. Queues come from the global
 * QueueModule; Prisma / MerchantContext from the global PrismaModule.
 */
@Module({
  controllers: [WebhooksController],
  providers: [WebhookHmacGuard],
})
export class WebhooksModule {}
