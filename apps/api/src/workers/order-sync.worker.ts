import { Logger } from '@nestjs/common';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import type { OrderStatus } from '@prisma/client';
import * as Sentry from '@sentry/node';
import { PrismaService } from '../prisma/prisma.service';
import { MerchantContextService } from '../prisma/merchant-context.service';
import { ShopifyApiService } from '../shopify/shopify-api.service';
import type { ShopifyOrder } from '../shopify/shopify.types';
import { QUEUE_ORDER } from '../queues/queue.module';
import { asShopifyId, isFinalAttempt, type WebhookJobData } from './worker-helpers';

/** Map Shopify financial + fulfillment status to the platform order status. */
function mapStatus(order: ShopifyOrder): OrderStatus {
  if (order.cancelled_at) return 'cancelled';
  if (order.fulfillment_status === 'fulfilled') return 'fulfilled';
  if (order.financial_status === 'paid') return 'confirmed';
  return 'pending';
}

/**
 * Reconciles a platform order with Shopify on `orders/updated`. Runs as SYSTEM.
 * If the order is not yet known locally (update arrived before create), the
 * webhook is acknowledged without error.
 */
@Processor(QUEUE_ORDER, { concurrency: 5 })
export class OrderSyncWorker extends WorkerHost {
  private readonly logger = new Logger(OrderSyncWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantContext: MerchantContextService,
    private readonly shopify: ShopifyApiService,
  ) {
    super();
  }

  async process(job: Job<WebhookJobData>): Promise<void> {
    await this.merchantContext.runAsSystem(() => this.handle(job));
  }

  private async handle(job: Job<WebhookJobData>): Promise<void> {
    const { webhookEventId, shopifyDomain } = job.data;

    const event = await this.prisma.webhookEvent.findUnique({ where: { id: webhookEventId } });
    if (!event) {
      this.logger.warn(`Webhook event ${webhookEventId} not found; skipping`);
      return;
    }
    await this.prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: { status: 'processing', workerJobId: job.id ?? null, attemptCount: job.attemptsMade + 1 },
    });

    const payload = event.payloadJson as { id?: number | string } | null;
    const shopifyOrderId = asShopifyId(payload?.id);
    if (!shopifyOrderId) {
      throw new Error('orders/updated payload missing order id');
    }

    const local = await this.prisma.order.findUnique({
      where: { shopifyOrderId },
      select: { id: true, merchantId: true, status: true },
    });
    if (!local) {
      this.logger.warn(`Order ${shopifyOrderId} not found locally; acknowledging update`);
      await this.markProcessed(webhookEventId);
      return;
    }

    const merchant = await this.prisma.merchant.findFirst({
      where: { shopifyDomain, isActive: true },
      select: { shopifyDomain: true, shopifyAccessToken: true },
    });
    if (!merchant) {
      throw new Error(`No active merchant for ${shopifyDomain}`);
    }

    const order = await this.shopify.getOrder(merchant.shopifyDomain, merchant.shopifyAccessToken, shopifyOrderId);
    const nextStatus = mapStatus(order);

    await this.prisma.order.update({
      where: { id: local.id },
      data: { status: nextStatus, syncStatus: 'synced' },
    });

    await this.prisma.auditLog.create({
      data: {
        merchantId: local.merchantId,
        entityType: 'order',
        entityId: local.id,
        action: 'synced',
        actorType: 'shopify_webhook',
        oldValueJson: { status: local.status },
        newValueJson: { status: nextStatus },
      },
    });

    await this.markProcessed(webhookEventId);
    this.logger.log(`Synced order ${shopifyOrderId} → ${nextStatus}`);
  }

  private async markProcessed(webhookEventId: string): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: { status: 'processed', processedAt: new Date() },
    });
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<WebhookJobData>, error: Error): Promise<void> {
    if (!isFinalAttempt(job)) return;
    const { webhookEventId } = job.data;
    await this.merchantContext
      .runAsSystem(() =>
        this.prisma.webhookEvent.update({
          where: { id: webhookEventId },
          data: { status: 'dead_letter', lastError: error.message },
        }),
      )
      .catch(() => undefined);
    Sentry.captureException(error, {
      level: 'error',
      tags: { component: 'worker', queue: QUEUE_ORDER, job: job.name },
      extra: { webhookEventId, attempts: job.attemptsMade },
    });
    this.logger.error(`order:sync dead-letter ${webhookEventId}: ${error.message}`);
  }
}
