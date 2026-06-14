import { Global, Module } from '@nestjs/common';
import { InvoicePdfService } from './invoice-pdf.service';

/**
 * Invoicing & accounts receivable. Currently exposes the PDF generator used by
 * the invoice-generate worker (@react-pdf/renderer, SHA-256 integrity, 15s
 * timeout). Global so workers can inject {@link InvoicePdfService}. AR aging,
 * reminders and reconciliation services are added by the Invoices feature task.
 */
@Global()
@Module({
  providers: [InvoicePdfService],
  exports: [InvoicePdfService],
})
export class InvoicesModule {}
