import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { addDays, format } from 'date-fns';
import * as Sentry from '@sentry/node';
import type { InvoiceStatus } from '@b2b/shared';
import { PrismaService, type PrismaTransaction } from '../prisma/prisma.service';
import { MerchantContextService } from '../prisma/merchant-context.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { StorageService } from '../storage/storage.service';
import { EmailService } from '../email/email.service';
import { PAYMENT_TERMS_DAYS } from '../workers/worker-helpers';
import type { PaymentTerms } from '@b2b/shared';

const Money = Decimal.clone({ rounding: Decimal.ROUND_HALF_EVEN, precision: 40 });
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const CREDIT_CAS_RETRIES = 3;
const REMINDER_BATCH = 100;

export interface GenerateInvoiceParams {
  orderId: string;
  merchantId: string;
  buyerId: string;
  invoiceDate?: Date;
  paymentTerms: PaymentTerms;
}

export interface IntegrityResult {
  valid: boolean;
  storedHash: string | null;
  computedHash: string | null;
  checkedAt: string;
}

export interface ArAgingBucket {
  bucket: string;
  invoiceCount: number;
  outstandingAmount: string;
}

export interface ArAgingResult {
  current: ArAgingBucket;
  overdue_1_30: ArAgingBucket;
  overdue_31_60: ArAgingBucket;
  overdue_61_90: ArAgingBucket;
  overdue_90_plus: ArAgingBucket;
}

export interface MarkPaidDto {
  amountPaid: string;
  paidAt?: string;
  reference?: string;
}

const AGING_BUCKETS = [
  'current',
  'overdue_1_30',
  'overdue_31_60',
  'overdue_61_90',
  'overdue_90_plus',
] as const;
type AgingBucketKey = (typeof AGING_BUCKETS)[number];

interface AgingRow {
  bucket: string;
  invoice_count: bigint;
  outstanding_amount: Prisma.Decimal;
}

interface CreditRow {
  id: string;
  creditUsed: Prisma.Decimal;
  creditVersion: number;
}

/**
 * Invoicing & accounts receivable. Owns invoice generation/storage, buyer PDF
 * access (presigned, ownership-checked), void + mark-paid state transitions
 * (audited, with GMV + credit side effects), the AR-aging report, and the
 * scheduled overdue/reminder/sequence-gap jobs. All money uses Decimal.js with
 * banker's rounding; financial mutations run inside transactions.
 */
@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantContext: MerchantContextService,
    private readonly invoicePdf: InvoicePdfService,
    private readonly storage: StorageService,
    private readonly email: EmailService,
  ) {}

  // ── Generation ──────────────────────────────────────────────────────────

  /**
   * Generate, render, store and persist an invoice for an order. The PDF render
   * + S3 upload happen before the DB write so the transaction stays short.
   */
  async generateAndStoreInvoice(params: GenerateInvoiceParams): Promise<{ id: string; invoiceNumber: string }> {
    this.assertUuid(params.merchantId);
    this.assertUuid(params.orderId);

    return this.merchantContext.run(params.merchantId, async () => {
      const order = await this.prisma.order.findFirst({
        where: { id: params.orderId, merchantId: params.merchantId },
        select: {
          id: true,
          buyerId: true,
          subtotal: true,
          taxAmount: true,
          shippingAmount: true,
          total: true,
          currency: true,
          merchant: { select: { shopifyDomain: true } },
          buyer: { select: { companyName: true, email: true, addressJson: true } },
          lineItems: {
            select: {
              productTitle: true,
              variantTitle: true,
              sku: true,
              quantity: true,
              unitPrice: true,
              lineTotal: true,
            },
          },
        },
      });
      if (!order) {
        throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
      }

      const invoiceDate = params.invoiceDate ?? new Date();
      const dueDate = addDays(invoiceDate, PAYMENT_TERMS_DAYS[params.paymentTerms]);
      const invoiceNumber = await this.nextInvoiceNumber(invoiceDate);

      const pdf = await this.invoicePdf.generate({
        invoiceNumber,
        invoiceDate: format(invoiceDate, 'dd MMM yyyy'),
        dueDate: format(dueDate, 'dd MMM yyyy'),
        merchantName: order.merchant.shopifyDomain,
        buyerCompany: order.buyer.companyName,
        buyerEmail: order.buyer.email,
        buyerAddressLines: this.formatAddress(order.buyer.addressJson),
        currency: order.currency,
        paymentTerms: this.humanTerms(params.paymentTerms),
        lines: order.lineItems.map((li) => ({
          description: li.productTitle + (li.variantTitle ? ` — ${li.variantTitle}` : ''),
          sku: li.sku,
          quantity: li.quantity,
          unitPrice: li.unitPrice.toFixed(2),
          lineTotal: li.lineTotal.toFixed(2),
        })),
        subtotal: order.subtotal.toFixed(2),
        taxAmount: order.taxAmount.toFixed(2),
        shippingAmount: order.shippingAmount.toFixed(2),
        total: order.total.toFixed(2),
      });

      const upload = await this.storage.uploadInvoice({
        merchantId: params.merchantId,
        invoiceNumber,
        body: pdf.buffer,
      });

      const invoice = await this.prisma.withTenantTransaction((tx) =>
        tx.invoice.create({
          data: {
            orderId: order.id,
            merchantId: params.merchantId,
            buyerId: order.buyerId,
            invoiceNumber,
            invoiceDate,
            dueDate,
            subtotal: order.subtotal.toFixed(2),
            taxAmount: order.taxAmount.toFixed(2),
            total: order.total.toFixed(2),
            currency: order.currency,
            status: 'sent',
            pdfS3Key: upload.key,
            pdfSha256: pdf.sha256,
            sentAt: new Date(),
          },
          select: { id: true, invoiceNumber: true },
        }),
      );

      await this.writeAudit(params.merchantId, invoice.id, 'created', null, { invoiceNumber }, 'system');
      return invoice;
    });
  }

  // ── Integrity ───────────────────────────────────────────────────────────

  async verifyPdfIntegrity(invoiceId: string): Promise<IntegrityResult> {
    this.assertUuid(invoiceId);
    const checkedAt = new Date().toISOString();
    const invoice = await this.merchantContext.runAsSystem(() =>
      this.prisma.invoice.findUnique({
        where: { id: invoiceId },
        select: { pdfS3Key: true, pdfSha256: true, merchantId: true, invoiceNumber: true },
      }),
    );
    if (!invoice || !invoice.pdfS3Key) {
      throw new NotFoundException({ code: 'INVOICE_PDF_NOT_FOUND', message: 'Invoice PDF not found' });
    }

    const bytes = await this.storage.downloadObject(invoice.pdfS3Key);
    const { createHash } = await import('node:crypto');
    const computedHash = createHash('sha256').update(bytes).digest('hex');
    const valid = invoice.pdfSha256 !== null && computedHash === invoice.pdfSha256;

    if (!valid) {
      Sentry.captureMessage('Invoice PDF integrity mismatch', {
        level: 'fatal',
        tags: { component: 'invoices', check: 'integrity' },
        extra: {
          invoiceId,
          merchantId: invoice.merchantId,
          invoiceNumber: invoice.invoiceNumber,
          storedHash: invoice.pdfSha256,
          computedHash,
        },
      });
      this.logger.error(`PDF integrity mismatch for invoice ${invoice.invoiceNumber}`);
    }

    return { valid, storedHash: invoice.pdfSha256, computedHash, checkedAt };
  }

  // ── Buyer PDF access ──────────────────────────────────────────────────

  async getPresignedUrl(invoiceId: string, requestingBuyerId: string): Promise<string> {
    this.assertUuid(invoiceId);
    this.assertUuid(requestingBuyerId);
    const invoice = await this.merchantContext.runAsSystem(() =>
      this.prisma.invoice.findUnique({
        where: { id: invoiceId },
        select: { buyerId: true, pdfS3Key: true },
      }),
    );
    if (!invoice || !invoice.pdfS3Key) {
      throw new NotFoundException({ code: 'INVOICE_PDF_NOT_FOUND', message: 'Invoice PDF not found' });
    }
    if (invoice.buyerId !== requestingBuyerId) {
      throw new ForbiddenException({ code: 'INVOICE_ACCESS_DENIED', message: 'Not your invoice' });
    }

    // Atomic first-view stamp (only sets when currently null).
    await this.merchantContext.runAsSystem(() =>
      this.prisma.invoice.updateMany({
        where: { id: invoiceId, firstViewedAt: null },
        data: { firstViewedAt: new Date() },
      }),
    );

    return this.storage.getPresignedUrl(invoice.pdfS3Key, 3600);
  }

  // ── Void ────────────────────────────────────────────────────────────────

  async voidInvoice(
    invoiceId: string,
    merchantId: string,
    reason: string,
    actorId: string,
  ): Promise<{ id: string; status: InvoiceStatus }> {
    this.assertUuid(invoiceId);
    this.assertUuid(merchantId);
    this.assertUuid(actorId);

    const result = await this.merchantContext.run(merchantId, () =>
      this.prisma.withTenantTransaction(async (tx) => {
        const invoice = await tx.invoice.findFirst({
          where: { id: invoiceId, merchantId },
          select: { id: true, status: true, buyerId: true, invoiceNumber: true },
        });
        if (!invoice) {
          throw new NotFoundException({ code: 'INVOICE_NOT_FOUND', message: 'Invoice not found' });
        }
        if (invoice.status === 'void' || invoice.status === 'paid') {
          throw new ConflictException({
            code: 'INVOICE_NOT_VOIDABLE',
            message: `Invoice is ${invoice.status} and cannot be voided`,
          });
        }
        const updated = await tx.invoice.update({
          where: { id: invoiceId },
          data: { status: 'void', voidedAt: new Date(), voidReason: reason },
          select: { id: true, status: true, buyerId: true, invoiceNumber: true },
        });
        await this.writeAudit(
          merchantId,
          invoiceId,
          'voided',
          { status: invoice.status },
          { status: 'void', reason },
          'merchant_user',
          actorId,
          tx,
        );
        return updated;
      }),
    );

    // Notify the buyer (non-throwing).
    const buyer = await this.merchantContext.runAsSystem(() =>
      this.prisma.buyer.findUnique({ where: { id: result.buyerId }, select: { email: true, companyName: true } }),
    );
    const merchant = await this.merchantContext.runAsSystem(() =>
      this.prisma.merchant.findUnique({ where: { id: merchantId }, select: { shopifyDomain: true } }),
    );
    if (buyer) {
      await this.email.sendInvoiceVoidNotification({
        to: buyer.email,
        buyerCompany: buyer.companyName,
        merchantName: merchant?.shopifyDomain ?? 'your supplier',
        invoiceNumber: result.invoiceNumber,
        reason,
      });
    }

    return { id: result.id, status: result.status as InvoiceStatus };
  }

  // ── Mark paid ────────────────────────────────────────────────────────

  async markAsPaid(
    invoiceId: string,
    merchantId: string,
    dto: MarkPaidDto,
    actorId: string,
  ): Promise<{ id: string; status: InvoiceStatus; amountPaid: string }> {
    this.assertUuid(invoiceId);
    this.assertUuid(merchantId);
    this.assertUuid(actorId);

    const payment = new Money(dto.amountPaid);
    if (payment.lessThanOrEqualTo(0)) {
      throw new BadRequestException({ code: 'INVALID_AMOUNT', message: 'Payment amount must be positive' });
    }

    const outcome = await this.merchantContext.run(merchantId, () =>
      this.prisma.withTenantTransaction(async (tx) => {
        const rows = await tx.$queryRaw<
          Array<{
            id: string;
            status: string;
            total: Prisma.Decimal;
            amountPaid: Prisma.Decimal;
            buyerId: string;
            orderTotal: Prisma.Decimal;
          }>
        >`
          SELECT i.id,
                 i.status,
                 i.total,
                 i.amount_paid AS "amountPaid",
                 i.buyer_id    AS "buyerId",
                 i.total       AS "orderTotal"
          FROM invoices i
          WHERE i.id = ${invoiceId}::uuid AND i.merchant_id = ${merchantId}::uuid
          FOR UPDATE`;
        const invoice = rows[0];
        if (!invoice) {
          throw new NotFoundException({ code: 'INVOICE_NOT_FOUND', message: 'Invoice not found' });
        }
        if (invoice.status === 'paid' || invoice.status === 'void') {
          throw new ConflictException({
            code: 'INVOICE_NOT_PAYABLE',
            message: `Invoice is ${invoice.status}`,
          });
        }

        const total = new Money(invoice.total.toString());
        const prevPaid = new Money(invoice.amountPaid.toString());
        const newPaid = Money.min(prevPaid.plus(payment), total);
        const fullyPaid = newPaid.greaterThanOrEqualTo(total);
        const newStatus: InvoiceStatus = fullyPaid ? 'paid' : 'partially_paid';
        const paidDelta = newPaid.minus(prevPaid);

        await tx.invoice.update({
          where: { id: invoiceId },
          data: {
            amountPaid: newPaid.toFixed(2),
            status: newStatus,
            paidAt: fullyPaid ? new Date(dto.paidAt ?? Date.now()) : null,
          },
        });

        // GMV: add the newly-collected delta, rolling the month bucket over.
        await this.applyGmv(tx, merchantId, paidDelta);

        // Credit: free up the collected delta against the buyer relationship.
        await this.decrementCredit(tx, merchantId, invoice.buyerId, paidDelta);

        await this.writeAudit(
          merchantId,
          invoiceId,
          'paid',
          { status: invoice.status, amountPaid: prevPaid.toFixed(2) },
          { status: newStatus, amountPaid: newPaid.toFixed(2), reference: dto.reference ?? null },
          'merchant_user',
          actorId,
          tx,
        );

        return { status: newStatus, amountPaid: newPaid.toFixed(2) };
      }),
    );

    return { id: invoiceId, status: outcome.status, amountPaid: outcome.amountPaid };
  }

  // ── AR aging ─────────────────────────────────────────────────────────

  async getArAging(merchantId: string): Promise<ArAgingResult> {
    this.assertUuid(merchantId);
    const rows = await this.merchantContext.run(merchantId, () =>
      this.prisma.$queryRaw<AgingRow[]>`
        WITH aging AS (
          SELECT
            CASE
              WHEN due_date >= NOW() THEN 'current'
              WHEN due_date >= NOW() - INTERVAL '30 days' THEN 'overdue_1_30'
              WHEN due_date >= NOW() - INTERVAL '60 days' THEN 'overdue_31_60'
              WHEN due_date >= NOW() - INTERVAL '90 days' THEN 'overdue_61_90'
              ELSE 'overdue_90_plus'
            END AS bucket,
            COUNT(*) AS invoice_count,
            COALESCE(SUM(total - amount_paid), 0) AS outstanding_amount
          FROM invoices
          WHERE merchant_id = ${merchantId}::uuid
            AND status IN ('sent','viewed','partially_paid','overdue')
          GROUP BY bucket
        )
        SELECT bucket, invoice_count, outstanding_amount FROM aging`,
    );

    const byBucket = new Map<string, AgingRow>();
    for (const row of rows) {
      byBucket.set(row.bucket, row);
    }
    const build = (key: AgingBucketKey): ArAgingBucket => {
      const row = byBucket.get(key);
      return {
        bucket: key,
        invoiceCount: row ? Number(row.invoice_count) : 0,
        outstandingAmount: row ? new Money(row.outstanding_amount.toString()).toFixed(2) : '0.00',
      };
    };

    return {
      current: build('current'),
      overdue_1_30: build('overdue_1_30'),
      overdue_31_60: build('overdue_31_60'),
      overdue_61_90: build('overdue_61_90'),
      overdue_90_plus: build('overdue_90_plus'),
    };
  }

  // ── Scheduled jobs ────────────────────────────────────────────────────

  @Cron('0 * * * *')
  async runOverdueDetection(): Promise<{ updatedCount: number }> {
    return this.merchantContext.runAsSystem(async () => {
      const updated = await this.prisma.$executeRaw`
        UPDATE invoices
        SET status = 'overdue', updated_at = NOW()
        WHERE status IN ('sent','viewed','partially_paid') AND due_date < NOW()`;
      if (updated > 0) {
        this.logger.log(`Overdue detection marked ${updated} invoice(s) overdue`);
      }
      return { updatedCount: updated };
    });
  }

  @Cron('0 7 * * *')
  async sendPaymentReminders(): Promise<{ sentCount: number }> {
    return this.merchantContext.runAsSystem(async () => {
      const invoices = await this.prisma.invoice.findMany({
        where: {
          status: 'overdue',
          reminderCount: { lt: 3 },
          OR: [
            { lastReminderAt: null },
            { lastReminderAt: { lt: addDays(new Date(), -7) } },
          ],
        },
        take: REMINDER_BATCH,
        select: {
          id: true,
          invoiceNumber: true,
          total: true,
          amountPaid: true,
          dueDate: true,
          currency: true,
          reminderCount: true,
          merchant: { select: { shopifyDomain: true } },
          buyer: { select: { email: true } },
        },
      });

      let sentCount = 0;
      for (const invoice of invoices) {
        const nextCount = (invoice.reminderCount + 1) as 1 | 2 | 3;
        const outstanding = new Money(invoice.total.toString())
          .minus(new Money(invoice.amountPaid.toString()))
          .toFixed(2);
        const daysOverdue = Math.max(
          0,
          Math.floor((Date.now() - invoice.dueDate.getTime()) / (24 * 60 * 60 * 1000)),
        );
        try {
          const result = await this.email.sendPaymentReminderEmail({
            to: invoice.buyer.email,
            invoiceNumber: invoice.invoiceNumber,
            merchantName: invoice.merchant.shopifyDomain,
            merchantEmail: invoice.merchant.shopifyDomain,
            outstandingAmount: outstanding,
            currency: invoice.currency,
            dueDate: format(invoice.dueDate, 'dd MMM yyyy'),
            daysOverdue,
            reminderCount: nextCount,
            portalUrl: null,
          });
          if (result.sent) {
            sentCount += 1;
          }
          await this.prisma.invoice.update({
            where: { id: invoice.id },
            data: { reminderCount: nextCount, lastReminderAt: new Date() },
          });
        } catch (error) {
          this.logger.error(
            `Reminder failed for invoice ${invoice.invoiceNumber}: ${(error as Error).message}`,
          );
        }
      }
      if (sentCount > 0) {
        this.logger.log(`Sent ${sentCount} payment reminder(s)`);
      }
      return { sentCount };
    });
  }

  @Cron('0 2 * * *')
  async checkSequenceGaps(): Promise<void> {
    await this.merchantContext.runAsSystem(async () => {
      const gaps = await this.prisma.$queryRaw<
        Array<{ merchantId: string; expected: number; found: number; invoiceNumber: string }>
      >`
        WITH numbered AS (
          SELECT
            merchant_id,
            invoice_number,
            CAST(SPLIT_PART(invoice_number, '-', 3) AS INTEGER) AS seq,
            LAG(CAST(SPLIT_PART(invoice_number, '-', 3) AS INTEGER)) OVER (
              ORDER BY CAST(SPLIT_PART(invoice_number, '-', 3) AS INTEGER)
            ) AS prev_seq
          FROM invoices
        )
        SELECT merchant_id AS "merchantId",
               prev_seq + 1 AS expected,
               seq AS found,
               invoice_number AS "invoiceNumber"
        FROM numbered
        WHERE prev_seq IS NOT NULL AND seq <> prev_seq + 1`;

      for (const gap of gaps) {
        Sentry.captureMessage('Invoice sequence gap detected', {
          level: 'fatal',
          tags: { component: 'invoices', check: 'sequence_gap' },
          extra: gap,
        });
        this.logger.error(
          `Invoice sequence gap: expected ${gap.expected}, found ${gap.found} (${gap.invoiceNumber})`,
        );
      }
    });
  }

  // ── Resend ───────────────────────────────────────────────────────────

  /**
   * Re-send the invoice email to the buyer with a fresh presigned download link.
   * Merchant-initiated; scoped to the merchant. Per-invoice rate limiting is
   * enforced by the controller. Non-throwing email semantics are preserved —
   * a delivery failure surfaces as `{ sent: false }`.
   */
  async resendInvoiceEmail(
    invoiceId: string,
    merchantId: string,
  ): Promise<{ sent: boolean }> {
    this.assertUuid(invoiceId);
    this.assertUuid(merchantId);

    const invoice = await this.merchantContext.run(merchantId, () =>
      this.prisma.invoice.findFirst({
        where: { id: invoiceId, merchantId },
        select: {
          invoiceNumber: true,
          total: true,
          currency: true,
          dueDate: true,
          status: true,
          pdfS3Key: true,
          merchant: { select: { shopifyDomain: true } },
          buyer: { select: { email: true, companyName: true } },
          order: {
            select: {
              paymentTerms: true,
              lineItems: {
                select: { productTitle: true, variantTitle: true, quantity: true, lineTotal: true },
              },
            },
          },
        },
      }),
    );
    if (!invoice) {
      throw new NotFoundException({ code: 'INVOICE_NOT_FOUND', message: 'Invoice not found' });
    }
    if (invoice.status === 'void') {
      throw new ConflictException({
        code: 'INVOICE_VOID',
        message: 'A voided invoice cannot be re-sent',
      });
    }

    let presignedUrl: string | null = null;
    if (invoice.pdfS3Key) {
      try {
        presignedUrl = await this.storage.getPresignedUrl(invoice.pdfS3Key, 3600);
      } catch (error) {
        this.logger.error(`Failed to presign invoice ${invoice.invoiceNumber} for resend: ${(error as Error).message}`);
      }
    }

    const paymentTerms = invoice.order?.paymentTerms ?? null;
    const result = await this.email.sendInvoiceEmail({
      to: invoice.buyer.email,
      buyerCompany: invoice.buyer.companyName,
      merchantName: invoice.merchant.shopifyDomain,
      invoiceNumber: invoice.invoiceNumber,
      total: invoice.total.toFixed(2),
      currency: invoice.currency,
      dueDate: format(invoice.dueDate, 'dd MMM yyyy'),
      paymentTerms: paymentTerms ? this.humanTerms(paymentTerms) : 'Due on receipt',
      presignedUrl,
      lineItems: (invoice.order?.lineItems ?? []).map((li) => ({
        description: li.productTitle + (li.variantTitle ? ` — ${li.variantTitle}` : ''),
        quantity: li.quantity,
        lineTotal: li.lineTotal.toFixed(2),
      })),
    });

    return { sent: result.sent };
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private async applyGmv(tx: PrismaTransaction, merchantId: string, delta: Decimal): Promise<void> {
    if (delta.lessThanOrEqualTo(0)) return;
    const monthKey = format(new Date(), 'yyyy-MM');
    // Roll the bucket over if the stored month differs, then add the delta.
    await tx.$executeRaw`
      UPDATE merchants
      SET gmv_current_month = CASE WHEN gmv_month_key = ${monthKey}
                                   THEN gmv_current_month + ${delta.toFixed(2)}::numeric
                                   ELSE ${delta.toFixed(2)}::numeric END,
          gmv_month_key = ${monthKey},
          updated_at = NOW()
      WHERE id = ${merchantId}::uuid`;
  }

  private async decrementCredit(
    tx: PrismaTransaction,
    merchantId: string,
    buyerId: string,
    delta: Decimal,
  ): Promise<void> {
    if (delta.lessThanOrEqualTo(0)) return;
    for (let attempt = 0; attempt < CREDIT_CAS_RETRIES; attempt += 1) {
      const rows = await tx.$queryRaw<CreditRow[]>`
        SELECT id, credit_used AS "creditUsed", credit_version AS "creditVersion"
        FROM merchant_buyer_relationships
        WHERE merchant_id = ${merchantId}::uuid AND buyer_id = ${buyerId}::uuid`;
      const rel = rows[0];
      if (!rel) return;
      const updated = await tx.$executeRaw`
        UPDATE merchant_buyer_relationships
        SET credit_used = GREATEST(credit_used - ${delta.toFixed(2)}::numeric, 0),
            credit_version = credit_version + 1,
            updated_at = NOW()
        WHERE id = ${rel.id}::uuid AND credit_version = ${rel.creditVersion}`;
      if (updated > 0) return;
    }
    this.logger.warn(`Credit decrement CAS exhausted for buyer ${buyerId} / merchant ${merchantId}`);
  }

  private async nextInvoiceNumber(invoiceDate: Date): Promise<string> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ nextval: bigint }>>(
      "SELECT nextval('invoice_number_seq') AS nextval",
    );
    const seq = rows[0]?.nextval ?? 0n;
    return `INV-${invoiceDate.getUTCFullYear()}-${String(seq).padStart(6, '0')}`;
  }

  private formatAddress(addressJson: Prisma.JsonValue | null): string[] {
    if (!addressJson || typeof addressJson !== 'object' || Array.isArray(addressJson)) {
      return [];
    }
    const a = addressJson as Record<string, unknown>;
    const str = (key: string): string => (typeof a[key] === 'string' ? (a[key] as string) : '');
    const lines = [
      str('line1') || str('address1') || str('street'),
      str('line2') || str('address2'),
      [str('city'), str('region') || str('province') || str('state'), str('postalCode') || str('zip')]
        .filter((v) => v.length > 0)
        .join(', '),
      str('country'),
    ];
    return lines.filter((line) => line.trim().length > 0);
  }

  private humanTerms(terms: PaymentTerms): string {
    const labels: Record<PaymentTerms, string> = {
      immediate: 'Due on receipt',
      net15: 'Net 15',
      net30: 'Net 30',
      net60: 'Net 60',
      net90: 'Net 90',
    };
    return labels[terms];
  }

  private async writeAudit(
    merchantId: string,
    invoiceId: string,
    action: string,
    oldValue: Prisma.InputJsonValue | null,
    newValue: Prisma.InputJsonValue | null,
    actorType: 'system' | 'merchant_user',
    actorId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    const data: Prisma.AuditLogCreateInput = {
      merchantId,
      entityType: 'invoice',
      entityId: invoiceId,
      action,
      actorType,
      ...(actorId ? { actorId } : {}),
      ...(oldValue !== null ? { oldValueJson: oldValue } : {}),
      ...(newValue !== null ? { newValueJson: newValue } : {}),
    };
    try {
      await client.auditLog.create({ data });
    } catch (error) {
      this.logger.error(`Failed to write invoice audit log: ${(error as Error).message}`);
    }
  }

  private assertUuid(value: string): void {
    if (!UUID_RE.test(value)) {
      throw new BadRequestException({ code: 'INVALID_ID', message: `Malformed id: ${value}` });
    }
  }
}
