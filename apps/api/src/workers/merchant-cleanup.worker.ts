import { Inject, Logger } from "@nestjs/common";
import {
  Processor,
  WorkerHost,
  OnWorkerEvent,
  InjectQueue,
} from "@nestjs/bullmq";
import { Queue, type Job } from "bullmq";
import { Redis } from "ioredis";
import { Paddle, Environment } from "@paddle/paddle-node-sdk";
import type CircuitBreaker from "opossum";
import * as Sentry from "@sentry/node";
import { PrismaService } from "../prisma/prisma.service";
import { MerchantContextService } from "../prisma/merchant-context.service";
import { AppConfigService } from "../config/app-config.service";
import { CircuitBreakerFactory } from "../common/circuit-breaker/circuit-breaker.factory";
import { REDIS_CACHE } from "../redis/redis.module";
import {
  JOB_MERCHANT_CLEANUP,
  JOB_MERCHANT_PURGE_DATA,
  QUEUE_MERCHANT,
} from "../queues/queue.module";
import { MerchantPurgeService } from "./merchant-purge-data.worker";
import {
  isFinalAttempt,
  type MerchantPurgeJobData,
  type WebhookJobData,
} from "./worker-helpers";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Sole consumer of the `merchant` queue. Dispatches by job name: the
 * `app/uninstalled` cleanup, and the 90-day-delayed data purge (delegated to
 * {@link MerchantPurgeService}). Concurrency 1 so a merchant's lifecycle steps
 * never interleave. Runs as SYSTEM.
 *
 * Note: with Clerk, sessions/refresh tokens are owned by Clerk — there is no
 * local `refresh_tokens` table to revoke on uninstall (deactivating the merchant
 * is what blocks buyer/merchant access via the guards).
 */
@Processor(QUEUE_MERCHANT, { concurrency: 1 })
export class MerchantWorker extends WorkerHost {
  private readonly logger = new Logger(MerchantWorker.name);
  private readonly paddle: Paddle;
  private readonly cancelBreaker: CircuitBreaker<[string], void>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantContext: MerchantContextService,
    private readonly config: AppConfigService,
    breakerFactory: CircuitBreakerFactory,
    @InjectQueue(QUEUE_MERCHANT) private readonly merchantQueue: Queue,
    @Inject(REDIS_CACHE) private readonly cache: Redis,
    private readonly purge: MerchantPurgeService,
  ) {
    super();
    this.paddle = new Paddle(this.config.get("PADDLE_API_KEY"), {
      environment:
        this.config.get("PADDLE_ENV") === "production"
          ? Environment.production
          : Environment.sandbox,
    });
    this.cancelBreaker = breakerFactory.create<[string], void>(
      "paddle:cancel",
      async (subscriptionId: string) => {
        await this.paddle.subscriptions.cancel(subscriptionId, {
          effectiveFrom: "immediately",
        });
      },
    );
  }

  async process(job: Job): Promise<void> {
    await this.merchantContext.runAsSystem(async () => {
      switch (job.name) {
        case JOB_MERCHANT_CLEANUP:
          await this.cleanup(job as Job<WebhookJobData>);
          break;
        case JOB_MERCHANT_PURGE_DATA:
          await this.purge.run(job as Job<MerchantPurgeJobData>);
          break;
        default:
          this.logger.warn(`Unknown merchant job: ${job.name}`);
      }
    });
  }

  private async cleanup(job: Job<WebhookJobData>): Promise<void> {
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

    const merchant = await this.prisma.merchant.findFirst({
      where: { shopifyDomain },
      select: { id: true, subscriptionPaddleId: true },
    });
    if (!merchant) {
      this.logger.warn(
        `No merchant for ${shopifyDomain}; acknowledging uninstall`,
      );
      await this.markProcessed(webhookEventId);
      return;
    }

    await this.prisma.merchant.update({
      where: { id: merchant.id },
      data: { isActive: false, deletedAt: new Date() },
    });

    if (merchant.subscriptionPaddleId) {
      try {
        await this.cancelBreaker.fire(merchant.subscriptionPaddleId);
      } catch (error) {
        // A billing-cancellation failure must not block deactivation/cleanup.
        this.logger.error(
          `Paddle cancel failed for ${merchant.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    await this.deleteCatalogKeys(merchant.id);

    await this.merchantQueue.add(
      JOB_MERCHANT_PURGE_DATA,
      { merchantId: merchant.id },
      { delay: NINETY_DAYS_MS, priority: 1 },
    );

    await this.prisma.auditLog.create({
      data: {
        merchantId: merchant.id,
        entityType: "merchant",
        entityId: merchant.id,
        action: "cleanup",
        actorType: "shopify_webhook",
        newValueJson: { purgeScheduledInDays: 90 },
      },
    });

    await this.markProcessed(webhookEventId);
    this.logger.log(
      `Cleaned up merchant ${merchant.id}; purge scheduled in 90 days`,
    );
  }

  /** SCAN + DEL all catalog page + snapshot keys for the merchant. */
  private async deleteCatalogKeys(merchantId: string): Promise<void> {
    for (const pattern of [
      `catalog:page:${merchantId}:*`,
      `catalog:snapshot:${merchantId}:*`,
    ]) {
      let cursor = "0";
      do {
        const [next, keys] = await this.cache.scan(
          cursor,
          "MATCH",
          pattern,
          "COUNT",
          200,
        );
        cursor = next;
        if (keys.length > 0) {
          await this.cache.del(...keys);
        }
      } while (cursor !== "0");
    }
  }

  private async markProcessed(webhookEventId: string): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: { status: "processed", processedAt: new Date() },
    });
  }

  @OnWorkerEvent("failed")
  async onFailed(job: Job, error: Error): Promise<void> {
    if (!isFinalAttempt(job)) return;

    if (job.name === JOB_MERCHANT_CLEANUP) {
      const { webhookEventId } = job.data as WebhookJobData;
      await this.merchantContext
        .runAsSystem(() =>
          this.prisma.webhookEvent.update({
            where: { id: webhookEventId },
            data: { status: "dead_letter", lastError: error.message },
          }),
        )
        .catch(() => undefined);
    }
    Sentry.captureException(error, {
      level: "error",
      tags: { component: "worker", queue: QUEUE_MERCHANT, job: job.name },
      extra: { attempts: job.attemptsMade },
    });
    this.logger.error(`${job.name} dead-letter: ${error.message}`);
  }
}
