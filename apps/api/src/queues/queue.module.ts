import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import type { DefaultJobOptions } from 'bullmq';
import { QueueHealthService } from './queue-health.service';
import { QueueHealthController } from './queue-health.controller';

/** Queue name constants — the single source of truth for every producer/consumer. */
export const QUEUE_INVOICE = 'invoice';
export const QUEUE_ORDER = 'order';
export const QUEUE_CATALOG = 'catalog';
export const QUEUE_BUYER = 'buyer';
export const QUEUE_MERCHANT = 'merchant';

/** All registered queues, in priority-of-importance order. */
export const ALL_QUEUES = [
  QUEUE_INVOICE,
  QUEUE_ORDER,
  QUEUE_CATALOG,
  QUEUE_BUYER,
  QUEUE_MERCHANT,
] as const;

/** Job-name constants matched by the workers. */
export const JOB_INVOICE_GENERATE = 'invoice:generate';
export const JOB_INVOICE_MARK_PAID = 'invoice:mark-paid';
export const JOB_ORDER_SYNC = 'order:sync';
export const JOB_ORDER_FULFILLMENT_SYNC = 'order:fulfillment-sync';
export const JOB_ORDER_SHIPPING_EMAIL = 'order:send-shipping-email';
export const JOB_CATALOG_SYNC = 'catalog:sync';
export const JOB_BUYER_SYNC = 'buyer:sync';
export const JOB_MERCHANT_CLEANUP = 'merchant:cleanup';
export const JOB_MERCHANT_PURGE_DATA = 'merchant:purge-data';

/**
 * Shared defaults for every queue:
 *   - keep the last 500 completed jobs (and anything younger than 24h),
 *   - keep up to 2000 failed jobs for forensic inspection / replay,
 *   - retry up to 5 times with exponential backoff starting at 2s.
 * Per-job `priority` is set by the producer (lower number = higher priority).
 */
const DEFAULT_JOB_OPTIONS: DefaultJobOptions = {
  removeOnComplete: { count: 500, age: 86_400 },
  removeOnFail: { count: 2000 },
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000 },
};

/**
 * Registers all BullMQ queues on the REDIS_QUEUE connection (configured by
 * BullModule.forRootAsync in AppModule). Global so producers (the webhook
 * controller, schedulers) and consumers (workers) can inject the same queues
 * without re-registering. Priority queues are enabled by default in BullMQ.
 */
@Global()
@Module({
  imports: [
    BullModule.registerQueue(
      ...ALL_QUEUES.map((name) => ({ name, defaultJobOptions: DEFAULT_JOB_OPTIONS })),
    ),
  ],
  controllers: [QueueHealthController],
  providers: [QueueHealthService],
  exports: [BullModule, QueueHealthService],
})
export class QueueModule {}
