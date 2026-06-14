import { Module } from '@nestjs/common';
import { InvoiceWorker } from './invoice-generate.worker';
import { InvoiceMarkPaidService } from './invoice-mark-paid.worker';
import { OrderSyncWorker } from './order-sync.worker';
import { CatalogSyncWorker } from './catalog-sync.worker';
import { BuyerSyncWorker } from './buyer-sync.worker';
import { MerchantWorker } from './merchant-cleanup.worker';
import { MerchantPurgeService } from './merchant-purge-data.worker';

/**
 * BullMQ consumers. Each queue has exactly one WorkerHost consumer; queues that
 * carry multiple job types (invoice, merchant) dispatch by job name to a
 * delegated service so jobs are never split across competing workers.
 *
 * All collaborators (Prisma, MerchantContext, Shopify, Pricing, Storage, Email,
 * Redis, queues, circuit breakers) come from global modules.
 */
@Module({
  providers: [
    InvoiceWorker,
    InvoiceMarkPaidService,
    OrderSyncWorker,
    CatalogSyncWorker,
    BuyerSyncWorker,
    MerchantWorker,
    MerchantPurgeService,
  ],
})
export class WorkersModule {}
