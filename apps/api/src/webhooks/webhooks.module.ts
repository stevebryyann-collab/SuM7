import { Module } from "@nestjs/common";
import { WebhooksController } from "./webhooks.controller";
import { ComplianceWebhooksController } from "./compliance-webhooks.controller";
import { WebhookStatsController } from "./webhook-stats.controller";
import { WebhookHmacGuard } from "./webhook-hmac.guard";
import { AuthModule } from "../auth/auth.module";

/**
 * Inbound Shopify webhook ingestion. Routes under /webhooks/* receive the raw
 * request body (preserved in main.ts) for HMAC verification and are exempt from
 * the rate-limit guard. The WebhookHmacGuard performs all three verification
 * checks; the controller records + enqueues. Queues come from the global
 * QueueModule; Prisma / MerchantContext from the global PrismaModule.
 */
@Module({
  imports: [AuthModule],
  controllers: [
    WebhooksController,
    ComplianceWebhooksController,
    WebhookStatsController,
  ],
  providers: [WebhookHmacGuard],
})
export class WebhooksModule {}
