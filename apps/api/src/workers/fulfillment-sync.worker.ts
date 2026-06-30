import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Job } from 'bullmq';
import type { OrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JOB_ORDER_SHIPPING_EMAIL, QUEUE_ORDER } from '../queues/queue.module';
import { asShopifyId, type WebhookJobData } from './worker-helpers';

/** The subset of a Shopify fulfillment payload this worker reads. */
interface ShopifyFulfillment {
  order_id?: number | string;
  status?: string | null;
  tracking_number?: string | null;
  tracking_numbers?: string[] | null;
  tracking_url?: string | null;
  tracking_urls?: string[] | null;
  tracking_company?: string | null;
  created_at?: string | null;
  estimated_delivery_at?: string | null;
}

function firstOf(single: string | null | undefined, many: string[] | null | undefined): string | null {
  if (typeof single === 'string' && single.length > 0) return single;
  if (Array.isArray(many) && many.length > 0 && typeof many[0] === 'string') return many[0];
  return null;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return new Date(value);
}

/**
 * Applies a Shopify `fulfillments/{create,update}` webhook to the local order:
 * persists carrier + tracking, stamps `shippedAt`, and marks the order
 * `fulfilled` when Shopify reports the fulfillment succeeded. It is NOT its own
 * BullMQ consumer — the single `order` queue worker ({@link OrderSyncWorker})
 * dispatches by job name and delegates here, so fulfillment, sync and email jobs
 * are never split across competing consumers. Assumes the SYSTEM (bypass-RLS)
 * context opened by that worker. On success it enqueues the shipping email.
 */
@Injectable()
export class FulfillmentSyncService {
  private readonly logger = new Logger(FulfillmentSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_ORDER) private readonly orderQueue: Queue<WebhookJobData>,
  ) {}

  async run(job: Job<WebhookJobData>): Promise<void> {
    const { webhookEventId, shopifyDomain, topic } = job.data;

    const event = await this.prisma.webhookEvent.findUnique({ where: { id: webhookEventId } });
    if (!event) {
      this.logger.warn(`Webhook event ${webhookEventId} not found; skipping`);
      return;
    }
    await this.prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: { status: 'processing', workerJobId: job.id ?? null, attemptCount: job.attemptsMade + 1 },
    });

    const payload = (event.payloadJson ?? {}) as ShopifyFulfillment;
    const shopifyOrderId = asShopifyId(payload.order_id);
    if (!shopifyOrderId) {
      throw new Error('fulfillment payload missing order_id');
    }

    const order = await this.prisma.order.findUnique({
      where: { shopifyOrderId },
      select: { id: true, merchantId: true, status: true },
    });
    if (!order) {
      this.logger.warn(`Order ${shopifyOrderId} not found locally; acknowledging fulfillment`);
      await this.markProcessed(webhookEventId);
      return;
    }

    const trackingNumber = firstOf(payload.tracking_number, payload.tracking_numbers);
    const trackingUrl = firstOf(payload.tracking_url, payload.tracking_urls);
    const fulfillmentService = payload.tracking_company ?? null;
    const shippedAt = parseDate(payload.created_at) ?? new Date();
    const estimatedDeliveryAt = parseDate(payload.estimated_delivery_at);

    // Shopify "success" means the goods left the warehouse → reflect as fulfilled.
    const fulfilled = (payload.status ?? '').toLowerCase() === 'success';
    const nextStatus: OrderStatus = fulfilled ? 'fulfilled' : order.status;

    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        trackingNumber,
        trackingUrl,
        fulfillmentService,
        shippedAt,
        estimatedDeliveryAt,
        status: nextStatus,
        syncStatus: 'synced',
      },
    });

    await this.prisma.auditLog.create({
      data: {
        merchantId: order.merchantId,
        entityType: 'order',
        entityId: order.id,
        action: 'fulfillment_synced',
        actorType: 'shopify_webhook',
        oldValueJson: { status: order.status },
        newValueJson: { status: nextStatus, trackingNumber, fulfillmentService },
      },
    });

    // Best-effort buyer notification — enqueued so a Resend hiccup never blocks
    // the fulfillment write. Re-reads the same webhook payload for the order.
    await this.orderQueue.add(
      JOB_ORDER_SHIPPING_EMAIL,
      { webhookEventId, shopifyDomain, topic },
      { priority: 5 },
    );

    await this.markProcessed(webhookEventId);
    this.logger.log(`Synced fulfillment for order ${shopifyOrderId} (status ${nextStatus})`);
  }

  private async markProcessed(webhookEventId: string): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: { status: 'processed', processedAt: new Date() },
    });
  }
}
