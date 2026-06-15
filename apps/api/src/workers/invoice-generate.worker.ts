import { Logger } from '@nestjs/common';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { addDays, format } from 'date-fns';
import * as Sentry from '@sentry/node';
import { PrismaService } from '../prisma/prisma.service';
import { MerchantContextService } from '../prisma/merchant-context.service';
import { ShopifyApiService } from '../shopify/shopify-api.service';
import { InvoicePdfService } from '../invoices/invoice-pdf.service';
import { StorageService } from '../storage/storage.service';
import { EmailService } from '../email/email.service';
import { InvoiceMarkPaidService } from './invoice-mark-paid.worker';
import { JOB_INVOICE_GENERATE, JOB_INVOICE_MARK_PAID, QUEUE_INVOICE } from '../queues/queue.module';
import {
  PAYMENT_TERMS_DAYS,
  PAYMENT_TERMS_LABELS,
  asShopifyId,
  isFinalAttempt,
  type WebhookJobData,
} from './worker-helpers';

const ROUND = Decimal.ROUND_HALF_EVEN;
const money = (value: string | null | undefined): string =>
  new Decimal(value && value.length > 0 ? value : '0').toDecimalPlaces(2, ROUND).toFixed(2);

/**
 * Generates a buyer invoice from a Shopify `orders/create` webhook. Runs as the
 * SYSTEM (bypass RLS). Idempotent: if an invoice already exists for the Shopify
 * order, the webhook is marked processed and the job returns. The financial
 * writes (order upsert, line items, invoice) execute in one SERIALIZABLE
 * transaction; the PDF render + S3 upload happen first so the transaction stays
 * short (the connection has a 10s idle-in-transaction limit).
 *
 * This is the SOLE consumer of the `invoice` queue. It dispatches by job name so
 * generate and mark-paid jobs are never split across competing workers (which
 * would silently drop jobs); mark-paid is delegated to InvoiceMarkPaidService.
 */
@Processor(QUEUE_INVOICE, { concurrency: 5 })
export class InvoiceWorker extends WorkerHost {
  private readonly logger = new Logger(InvoiceWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantContext: MerchantContextService,
    private readonly shopify: ShopifyApiService,
    private readonly invoicePdf: InvoicePdfService,
    private readonly storage: StorageService,
    private readonly email: EmailService,
    private readonly markPaid: InvoiceMarkPaidService,
  ) {
    super();
  }

  async process(job: Job<WebhookJobData>): Promise<void> {
    await this.merchantContext.runAsSystem(async () => {
      switch (job.name) {
        case JOB_INVOICE_GENERATE:
          await this.handle(job);
          break;
        case JOB_INVOICE_MARK_PAID:
          await this.markPaid.run(job);
          break;
        default:
          this.logger.warn(`Unknown invoice job: ${job.name}`);
      }
    });
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
      throw new Error('orders/create payload missing order id');
    }

    // Idempotency: an invoice already linked to this Shopify order ends the job.
    const existing = await this.prisma.order.findUnique({
      where: { shopifyOrderId },
      select: { invoice: { select: { id: true } } },
    });
    if (existing?.invoice) {
      this.logger.log(`Invoice already exists for order ${shopifyOrderId}; marking processed`);
      await this.markProcessed(webhookEventId);
      return;
    }

    const merchant = await this.prisma.merchant.findFirst({
      where: { shopifyDomain, isActive: true },
      select: { id: true, shopifyDomain: true, shopifyAccessToken: true },
    });
    if (!merchant) {
      throw new Error(`No active merchant for ${shopifyDomain}`);
    }

    const order = await this.shopify.getOrder(merchant.shopifyDomain, merchant.shopifyAccessToken, shopifyOrderId);

    const email = order.email ?? order.customer?.email ?? null;
    if (!email) {
      this.logger.warn(`Order ${shopifyOrderId} has no buyer email; cannot invoice`);
      await this.markProcessed(webhookEventId);
      return;
    }

    const buyer = await this.prisma.buyer.findUnique({
      where: { email },
      select: { id: true, companyName: true },
    });
    if (!buyer) {
      this.logger.warn(`No buyer for ${email}; cannot invoice order ${shopifyOrderId}`);
      await this.markProcessed(webhookEventId);
      return;
    }

    const relationship = await this.prisma.merchantBuyerRelationship.findUnique({
      where: { merchantId_buyerId: { merchantId: merchant.id, buyerId: buyer.id } },
      select: { paymentTerms: true, pricingTierId: true },
    });
    if (!relationship) {
      this.logger.warn(`No relationship for buyer ${buyer.id} + merchant ${merchant.id}`);
      await this.markProcessed(webhookEventId);
      return;
    }

    const invoiceDate = new Date();
    const dueDate = addDays(invoiceDate, PAYMENT_TERMS_DAYS[relationship.paymentTerms]);
    const invoiceNumber = await this.nextInvoiceNumber(invoiceDate);

    const subtotal = money(order.subtotal_price);
    const taxAmount = money(order.total_tax);
    const shippingAmount = money(order.total_shipping_price_set?.shop_money.amount);
    const total = money(order.total_price);

    const lineItems = order.line_items.map((li) => {
      const unitPrice = money(li.price);
      const lineTotal = new Decimal(unitPrice).mul(li.quantity).toDecimalPlaces(2, ROUND).toFixed(2);
      return {
        shopifyVariantId: asShopifyId(li.variant_id),
        shopifyProductId: asShopifyId(li.product_id),
        productTitle: li.title,
        variantTitle: li.variant_title,
        sku: li.sku,
        quantity: li.quantity,
        unitPrice,
        lineTotal,
        currency: order.currency,
      };
    });

    // Render + store the PDF before opening the financial transaction.
    const pdf = await this.invoicePdf.generate({
      invoiceNumber,
      invoiceDate: format(invoiceDate, 'yyyy-MM-dd'),
      dueDate: format(dueDate, 'yyyy-MM-dd'),
      merchantName: merchant.shopifyDomain,
      buyerCompany: buyer.companyName,
      currency: order.currency,
      lines: lineItems.map((li) => ({
        description: li.productTitle + (li.variantTitle ? ` — ${li.variantTitle}` : ''),
        sku: li.sku,
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        lineTotal: li.lineTotal,
      })),
      subtotal,
      taxAmount,
      total,
    });
    const upload = await this.storage.uploadInvoice({
      merchantId: merchant.id,
      invoiceNumber,
      body: pdf.buffer,
    });

    const invoiceId = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.bypass_rls = 'true'`);

        const upserted = await tx.order.upsert({
          where: { shopifyOrderId },
          update: {
            subtotal,
            taxAmount,
            shippingAmount,
            total,
            currency: order.currency,
            paymentTerms: relationship.paymentTerms,
            dueDate,
            status: 'confirmed',
            syncStatus: 'synced',
            pricingTierIdAtOrder: relationship.pricingTierId,
          },
          create: {
            merchantId: merchant.id,
            buyerId: buyer.id,
            shopifyOrderId,
            shopifyOrderNumber: String(order.order_number),
            subtotal,
            taxAmount,
            shippingAmount,
            total,
            currency: order.currency,
            paymentTerms: relationship.paymentTerms,
            dueDate,
            status: 'confirmed',
            syncStatus: 'synced',
            pricingTierIdAtOrder: relationship.pricingTierId,
          },
          select: { id: true },
        });

        await tx.orderLineItem.deleteMany({ where: { orderId: upserted.id } });
        await tx.orderLineItem.createMany({
          data: lineItems.map((li) => ({ orderId: upserted.id, ...li })),
        });

        const invoice = await tx.invoice.create({
          data: {
            orderId: upserted.id,
            merchantId: merchant.id,
            buyerId: buyer.id,
            invoiceNumber,
            invoiceDate,
            dueDate,
            subtotal,
            taxAmount,
            total,
            currency: order.currency,
            status: 'sent',
            pdfS3Key: upload.key,
            pdfSha256: pdf.sha256,
            sentAt: new Date(),
          },
          select: { id: true },
        });
        return invoice.id;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    // Email is best-effort delivery outside the financial transaction.
    let downloadUrl: string | null = null;
    try {
      downloadUrl = await this.storage.presignDownload(upload.key);
    } catch {
      downloadUrl = null;
    }
    await this.email.sendInvoiceEmail({
      to: email,
      buyerCompany: buyer.companyName,
      merchantName: merchant.shopifyDomain,
      invoiceNumber,
      total,
      currency: order.currency,
      dueDate: format(dueDate, 'yyyy-MM-dd'),
      paymentTerms: PAYMENT_TERMS_LABELS[relationship.paymentTerms],
      presignedUrl: downloadUrl,
      lineItems: lineItems.map((li) => ({
        description: li.productTitle + (li.variantTitle ? ` — ${li.variantTitle}` : ''),
        quantity: li.quantity,
        lineTotal: li.lineTotal,
      })),
    });

    await this.markProcessed(webhookEventId);
    await this.writeAudit(merchant.id, invoiceId, invoiceNumber);
    this.logger.log(`Generated invoice ${invoiceNumber} for order ${shopifyOrderId}`);
  }

  private async nextInvoiceNumber(invoiceDate: Date): Promise<string> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ nextval: bigint }>>(
      "SELECT nextval('invoice_number_seq') AS nextval",
    );
    const seq = rows[0]?.nextval ?? 0n;
    return `INV-${invoiceDate.getUTCFullYear()}-${String(seq).padStart(6, '0')}`;
  }

  private async markProcessed(webhookEventId: string): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: { status: 'processed', processedAt: new Date() },
    });
  }

  private async writeAudit(merchantId: string, invoiceId: string, invoiceNumber: string): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        merchantId,
        entityType: 'invoice',
        entityId: invoiceId,
        action: 'created',
        actorType: 'shopify_webhook',
        newValueJson: { invoiceNumber },
      },
    });
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<WebhookJobData>, error: Error): Promise<void> {
    if (!isFinalAttempt(job)) {
      return;
    }
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
      level: 'fatal',
      tags: { component: 'worker', queue: QUEUE_INVOICE, job: job.name },
      extra: { webhookEventId, attempts: job.attemptsMade, shopifyDomain: job.data.shopifyDomain },
    });
    this.logger.error(`invoice:generate dead-letter ${webhookEventId}: ${error.message}`);
  }
}
