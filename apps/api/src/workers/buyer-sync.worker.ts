import { Logger } from "@nestjs/common";
import { Processor, WorkerHost, OnWorkerEvent } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import * as Sentry from "@sentry/node";
import { PrismaService } from "../prisma/prisma.service";
import { MerchantContextService } from "../prisma/merchant-context.service";
import {
  JOB_BUYER_SYNC,
  JOB_GDPR_CUSTOMER_REDACT,
  JOB_GDPR_DATA_REQUEST,
  QUEUE_BUYER,
} from "../queues/queue.module";
import { GdprComplianceService } from "./gdpr-compliance.worker";
import { isFinalAttempt, type WebhookJobData } from "./worker-helpers";

/** Minimal shape of the Shopify customer webhook payload we read. */
interface ShopifyCustomerPayload {
  id?: number | string;
  email?: string | null;
  company?: string | null;
  default_address?: { company?: string | null } | null;
}

/**
 * Syncs Shopify customer data onto an existing buyer (matched by email). Only
 * fills `companyName` when the buyer has none — buyer identity is owned by the
 * platform/Clerk, not Shopify. Runs as SYSTEM (buyers carry no RLS).
 */
@Processor(QUEUE_BUYER, { concurrency: 5 })
export class BuyerSyncWorker extends WorkerHost {
  private readonly logger = new Logger(BuyerSyncWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantContext: MerchantContextService,
    private readonly gdpr: GdprComplianceService,
  ) {
    super();
  }

  async process(job: Job<WebhookJobData>): Promise<void> {
    await this.merchantContext.runAsSystem(() => {
      switch (job.name) {
        case JOB_GDPR_DATA_REQUEST:
          return this.gdpr.recordDataRequest(job);
        case JOB_GDPR_CUSTOMER_REDACT:
          return this.gdpr.redactCustomer(job);
        case JOB_BUYER_SYNC:
        default:
          return this.handle(job);
      }
    });
  }

  private async handle(job: Job<WebhookJobData>): Promise<void> {
    const { webhookEventId, shopifyDomain } = job.data;

    const event = await this.prisma.webhookEvent.findUnique({
      where: { id: webhookEventId },
    });
    if (!event) {
      this.logger.warn(`Webhook event ${webhookEventId} not found; skipping`);
      return;
    }
    await this.prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: {
        status: "processing",
        workerJobId: job.id ?? null,
        attemptCount: job.attemptsMade + 1,
      },
    });

    const payload = event.payloadJson as ShopifyCustomerPayload | null;
    const email = payload?.email ?? null;
    if (!email) {
      this.logger.warn("customers/create payload has no email; skipping");
      await this.markProcessed(webhookEventId);
      return;
    }

    const buyer = await this.prisma.buyer.findUnique({
      where: { email },
      select: { id: true, companyName: true },
    });
    if (!buyer) {
      this.logger.debug(`No platform buyer for ${email}; nothing to sync`);
      await this.markProcessed(webhookEventId);
      return;
    }

    const company =
      payload?.company ?? payload?.default_address?.company ?? null;
    if (company && buyer.companyName.trim().length === 0) {
      await this.prisma.buyer.update({
        where: { id: buyer.id },
        data: { companyName: company },
      });
    }

    const merchant = await this.prisma.merchant.findFirst({
      where: { shopifyDomain },
      select: { id: true },
    });

    await this.prisma.auditLog.create({
      data: {
        merchantId: merchant?.id ?? null,
        entityType: "buyer",
        entityId: buyer.id,
        action: "synced",
        actorType: "shopify_webhook",
        newValueJson: { email },
      },
    });

    await this.markProcessed(webhookEventId);
    this.logger.log(`Synced buyer ${buyer.id} from Shopify customer`);
  }

  private async markProcessed(webhookEventId: string): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: { status: "processed", processedAt: new Date() },
    });
  }

  @OnWorkerEvent("failed")
  async onFailed(job: Job<WebhookJobData>, error: Error): Promise<void> {
    if (!isFinalAttempt(job)) return;
    const { webhookEventId } = job.data;
    await this.merchantContext
      .runAsSystem(() =>
        this.prisma.webhookEvent.update({
          where: { id: webhookEventId },
          data: { status: "dead_letter", lastError: error.message },
        }),
      )
      .catch(() => undefined);
    Sentry.captureException(error, {
      level: "error",
      tags: { component: "worker", queue: QUEUE_BUYER, job: job.name },
      extra: { webhookEventId, attempts: job.attemptsMade },
    });
    this.logger.error(
      `buyer:sync dead-letter ${webhookEventId}: ${error.message}`,
    );
  }
}
