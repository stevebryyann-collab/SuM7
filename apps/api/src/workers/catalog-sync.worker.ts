import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { Redis } from 'ioredis';
import { createHash } from 'node:crypto';
import * as Sentry from '@sentry/node';
import { PrismaService } from '../prisma/prisma.service';
import { MerchantContextService } from '../prisma/merchant-context.service';
import { ShopifyApiService } from '../shopify/shopify-api.service';
import { REDIS_CACHE } from '../redis/redis.module';
import { QUEUE_CATALOG } from '../queues/queue.module';
import { asShopifyId, isFinalAttempt, type WebhookJobData } from './worker-helpers';

const SNAPSHOT_TTL_SECONDS = 2_592_000; // 30 days

/**
 * Keeps the platform's per-variant pricing override snapshot in sync with
 * Shopify products. Change detection uses a Redis SHA-256 snapshot so unchanged
 * re-deliveries are no-ops. On change: refresh override list prices, prune
 * overrides for removed variants, and invalidate the catalog page cache. Runs
 * as SYSTEM.
 */
@Processor(QUEUE_CATALOG, { concurrency: 10 })
export class CatalogSyncWorker extends WorkerHost {
  private readonly logger = new Logger(CatalogSyncWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantContext: MerchantContextService,
    private readonly shopify: ShopifyApiService,
    @Inject(REDIS_CACHE) private readonly cache: Redis,
  ) {
    super();
  }

  async process(job: Job<WebhookJobData>): Promise<void> {
    await this.merchantContext.runAsSystem(() => this.handle(job));
  }

  private async handle(job: Job<WebhookJobData>): Promise<void> {
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

    const payload = event.payloadJson as { id?: number | string } | null;
    const productId = asShopifyId(payload?.id);
    if (!productId) {
      throw new Error('product webhook payload missing product id');
    }

    const merchant = await this.prisma.merchant.findFirst({
      where: { shopifyDomain, isActive: true },
      select: { id: true, shopifyDomain: true, shopifyAccessToken: true },
    });
    if (!merchant) {
      throw new Error(`No active merchant for ${shopifyDomain}`);
    }

    const snapshotKey = `catalog:snapshot:${merchant.id}:${productId}`;

    // ── Deletion ─────────────────────────────────────────────────────────
    if (topic === 'products/delete') {
      await this.prisma.pricingTierOverride.deleteMany({
        where: { shopifyProductId: productId, pricingTier: { merchantId: merchant.id } },
      });
      await this.cache.del(snapshotKey);
      await this.invalidatePages(merchant.id);
      await this.writeAudit(merchant.id, productId, 'deleted');
      await this.markProcessed(webhookEventId);
      this.logger.log(`Deleted catalog product ${productId} for merchant ${merchant.id}`);
      return;
    }

    // ── Create / update ──────────────────────────────────────────────────
    const product = await this.shopify.getProduct(merchant.shopifyDomain, merchant.shopifyAccessToken, productId);
    const hash = createHash('sha256').update(JSON.stringify(product)).digest('hex');

    const previous = await this.cache.get(snapshotKey);
    if (previous === hash) {
      this.logger.debug(`Product ${productId} unchanged; skipping`);
      await this.markProcessed(webhookEventId);
      return;
    }
    await this.cache.set(snapshotKey, hash, 'EX', SNAPSHOT_TTL_SECONDS);

    const variantIds = product.variants.map((variant) => String(variant.id));

    // Refresh the list price (compareAtPrice) on existing overrides per variant.
    for (const variant of product.variants) {
      await this.prisma.pricingTierOverride.updateMany({
        where: {
          shopifyProductId: productId,
          shopifyVariantId: String(variant.id),
          pricingTier: { merchantId: merchant.id },
        },
        data: { compareAtPrice: variant.price },
      });
    }

    // Prune overrides for variants that no longer exist on the product.
    if (variantIds.length > 0) {
      await this.prisma.pricingTierOverride.deleteMany({
        where: {
          shopifyProductId: productId,
          pricingTier: { merchantId: merchant.id },
          shopifyVariantId: { notIn: variantIds },
        },
      });
    }

    await this.invalidatePages(merchant.id);
    await this.writeAudit(merchant.id, productId, 'synced');
    await this.markProcessed(webhookEventId);
    this.logger.log(`Synced catalog product ${productId} for merchant ${merchant.id}`);
  }

  /** SCAN + DEL every cached catalog page for the merchant. */
  private async invalidatePages(merchantId: string): Promise<void> {
    const pattern = `catalog:page:${merchantId}:*`;
    let cursor = '0';
    do {
      const [next, keys] = await this.cache.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = next;
      if (keys.length > 0) {
        await this.cache.del(...keys);
      }
    } while (cursor !== '0');
  }

  private async writeAudit(merchantId: string, productId: string, action: string): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        merchantId,
        entityType: 'catalog_product',
        entityId: merchantId,
        action,
        actorType: 'shopify_webhook',
        newValueJson: { shopifyProductId: productId },
      },
    });
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
      tags: { component: 'worker', queue: QUEUE_CATALOG, job: job.name },
      extra: { webhookEventId, attempts: job.attemptsMade },
    });
    this.logger.error(`catalog:sync dead-letter ${webhookEventId}: ${error.message}`);
  }
}
