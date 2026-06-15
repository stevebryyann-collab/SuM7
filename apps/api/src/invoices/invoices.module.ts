import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoicesService } from './invoices.service';
import { InvoicesController } from './invoices.controller';

/**
 * Invoicing & accounts receivable. Exposes:
 *   - InvoicePdfService — the PDF generator used by the invoice-generate worker
 *     (@react-pdf/renderer, SHA-256 integrity, 15s timeout). Exported & @Global
 *     so workers can inject it.
 *   - InvoicesService — generate/verify/presign/void/mark-paid, AR aging and the
 *     scheduled overdue/reminder/sequence-gap crons.
 *   - InvoicesController — merchant AR endpoints + the buyer PDF download.
 *
 * Guards come from AuthModule; Prisma/MerchantContext, Storage, Email and the
 * cache Redis (REDIS_CACHE) are all global.
 */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [InvoicesController],
  providers: [InvoicePdfService, InvoicesService],
  exports: [InvoicePdfService, InvoicesService],
})
export class InvoicesModule {}
