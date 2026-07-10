import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { merchantDisplayNameFromDomain } from '@b2b/shared';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { asShopifyId, type WebhookJobData } from './worker-helpers';

/** The order_id carrier on a Shopify fulfillment payload. */
interface ShopifyFulfillmentRef {
  order_id?: number | string;
}

/**
 * Sends the buyer "your order has shipped" email after a fulfillment sync. Like
 * the other order-queue jobs it is delegated by {@link OrderSyncWorker} (single
 * consumer per queue) and runs inside the SYSTEM context. It re-reads the
 * fulfillment payload to find the order, loads buyer + merchant, and delivers
 * via the non-throwing EmailService — a delivery failure never fails the job.
 */
@Injectable()
export class ShippingEmailService {
  private readonly logger = new Logger(ShippingEmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  async run(job: Job<WebhookJobData>): Promise<void> {
    const { webhookEventId } = job.data;

    const event = await this.prisma.webhookEvent.findUnique({
      where: { id: webhookEventId },
      select: { payloadJson: true },
    });
    if (!event) {
      this.logger.warn(`Webhook event ${webhookEventId} not found; skipping shipping email`);
      return;
    }

    const payload = (event.payloadJson ?? {}) as ShopifyFulfillmentRef;
    const shopifyOrderId = asShopifyId(payload.order_id);
    if (!shopifyOrderId) {
      this.logger.warn('shipping-email job payload missing order_id; skipping');
      return;
    }

    const order = await this.prisma.order.findUnique({
      where: { shopifyOrderId },
      select: {
        shopifyOrderNumber: true,
        trackingNumber: true,
        trackingUrl: true,
        fulfillmentService: true,
        buyer: { select: { email: true, companyName: true } },
        merchant: { select: { shopifyDomain: true } },
      },
    });
    if (!order || !order.buyer.email) {
      this.logger.warn(`No buyer email for order ${shopifyOrderId}; skipping shipping email`);
      return;
    }

    const merchantName = merchantDisplayNameFromDomain(order.merchant.shopifyDomain);
    const orderNumber = order.shopifyOrderNumber ?? shopifyOrderId;

    const result = await this.email.sendOrderShippedEmail({
      to: order.buyer.email,
      merchantName,
      orderNumber,
      carrierName: order.fulfillmentService,
      trackingNumber: order.trackingNumber,
      trackingUrl: order.trackingUrl,
    });

    this.logger.log(
      `Shipping email for order ${shopifyOrderId} → ${order.buyer.email} (sent=${result.sent})`,
    );
  }
}
