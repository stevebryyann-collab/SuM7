import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { asShopifyId, type WebhookJobData } from './worker-helpers';

const ROUND = Decimal.ROUND_HALF_EVEN;
const CREDIT_CAS_RETRIES = 3;

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Marks an invoice paid in response to a Shopify `orders/paid` webhook. This is
 * NOT its own BullMQ consumer — the `invoice` queue has a single worker
 * (InvoiceWorker) that dispatches by job name, so generate and mark-paid jobs
 * are never load-balanced onto separate consumers (which would drop jobs). It
 * assumes it runs inside a SYSTEM (bypass-RLS) context opened by that worker.
 *
 * Within one SERIALIZABLE transaction: lock the invoice FOR UPDATE, skip if
 * already paid (idempotent), mark it paid, and roll the merchant GMV forward
 * (resetting on month change). The buyer credit is then released under an
 * optimistic version lock (CAS retried up to 3×).
 */
@Injectable()
export class InvoiceMarkPaidService {
  private readonly logger = new Logger(InvoiceMarkPaidService.name);

  constructor(private readonly prisma: PrismaService) {}

  async run(job: Job<WebhookJobData>): Promise<void> {
    const { webhookEventId } = job.data;

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
      throw new Error('orders/paid payload missing order id');
    }

    const order = await this.prisma.order.findUnique({
      where: { shopifyOrderId },
      select: { id: true, merchantId: true, buyerId: true, invoice: { select: { id: true } } },
    });
    if (!order?.invoice) {
      this.logger.warn(`No invoice for order ${shopifyOrderId}; acknowledging paid webhook`);
      await this.markProcessed(webhookEventId);
      return;
    }
    const invoiceId = order.invoice.id;

    const result = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.bypass_rls = 'true'`);

        // Row-lock the invoice so concurrent paid webhooks serialize here.
        await tx.$queryRawUnsafe('SELECT id FROM invoices WHERE id = $1 FOR UPDATE', invoiceId);

        const invoice = await tx.invoice.findUnique({
          where: { id: invoiceId },
          select: { status: true, total: true },
        });
        if (!invoice) {
          return { applied: false, total: '0' };
        }
        if (invoice.status === 'paid') {
          return { applied: false, total: invoice.total.toFixed(2) };
        }

        const total = invoice.total.toFixed(2);
        const paidAt = new Date();

        await tx.invoice.update({
          where: { id: invoiceId },
          data: { status: 'paid', paidAt, amountPaid: total },
        });

        // GMV rollover: reset the running total when the month key changes.
        const merchant = await tx.merchant.findUniqueOrThrow({
          where: { id: order.merchantId },
          select: { gmvCurrentMonth: true, gmvMonthKey: true },
        });
        const currentKey = monthKey(paidAt);
        const nextGmv =
          merchant.gmvMonthKey === currentKey
            ? new Decimal(merchant.gmvCurrentMonth.toString()).plus(total).toDecimalPlaces(2, ROUND)
            : new Decimal(total);
        await tx.merchant.update({
          where: { id: order.merchantId },
          data: { gmvCurrentMonth: nextGmv.toFixed(2), gmvMonthKey: currentKey },
        });

        return { applied: true, total };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (!result.applied) {
      this.logger.log(`Invoice ${invoiceId} already paid; skipped`);
      await this.markProcessed(webhookEventId);
      return;
    }

    await this.releaseCredit(order.merchantId, order.buyerId, result.total);

    await this.prisma.auditLog.create({
      data: {
        merchantId: order.merchantId,
        entityType: 'invoice',
        entityId: invoiceId,
        action: 'paid',
        actorType: 'shopify_webhook',
        newValueJson: { amountPaid: result.total },
      },
    });

    await this.markProcessed(webhookEventId);
    this.logger.log(`Marked invoice ${invoiceId} paid (${result.total})`);
  }

  /** Decrement creditUsed under an optimistic version lock, retried on CAS miss. */
  private async releaseCredit(merchantId: string, buyerId: string, amount: string): Promise<void> {
    for (let attempt = 0; attempt < CREDIT_CAS_RETRIES; attempt += 1) {
      const relationship = await this.prisma.merchantBuyerRelationship.findUnique({
        where: { merchantId_buyerId: { merchantId, buyerId } },
        select: { id: true, creditUsed: true, creditVersion: true },
      });
      if (!relationship) {
        return;
      }
      const nextUsed = Decimal.max(
        new Decimal(0),
        new Decimal(relationship.creditUsed.toString()).minus(amount),
      ).toDecimalPlaces(2, ROUND);

      const updated = await this.prisma.merchantBuyerRelationship.updateMany({
        where: { id: relationship.id, creditVersion: relationship.creditVersion },
        data: { creditUsed: nextUsed.toFixed(2), creditVersion: { increment: 1 } },
      });
      if (updated.count === 1) {
        return;
      }
    }
    this.logger.warn(
      `Credit release for buyer ${buyerId}/merchant ${merchantId} lost ${CREDIT_CAS_RETRIES} CAS races`,
    );
  }

  private async markProcessed(webhookEventId: string): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: { status: 'processed', processedAt: new Date() },
    });
  }
}
