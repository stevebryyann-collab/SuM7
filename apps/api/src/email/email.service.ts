import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Resend, type CreateEmailOptions } from 'resend';
import type CircuitBreaker from 'opossum';
import { AppConfigService } from '../config/app-config.service';
import { CircuitBreakerFactory } from '../common/circuit-breaker/circuit-breaker.factory';

export interface InvoiceEmailParams {
  to: string;
  buyerCompany: string;
  invoiceNumber: string;
  total: string;
  currency: string;
  dueDate: string;
  /** Short-lived presigned PDF download URL, or null if unavailable. */
  downloadUrl: string | null;
}

/**
 * Transactional email via Resend, wrapped in a circuit breaker so a Resend
 * outage fails fast instead of stalling workers. Templates render to inline HTML
 * (a clean, table-free transactional layout consistent with the design rules).
 */
@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend;
  private readonly from: string;
  private breaker!: CircuitBreaker<[CreateEmailOptions], void>;

  constructor(
    private readonly config: AppConfigService,
    private readonly breakerFactory: CircuitBreakerFactory,
  ) {
    this.resend = new Resend(this.config.get('RESEND_API_KEY'));
    this.from = this.config.get('RESEND_FROM_ADDRESS');
  }

  onModuleInit(): void {
    this.breaker = this.breakerFactory.create<[CreateEmailOptions], void>(
      'resend',
      (payload: CreateEmailOptions) => this.deliver(payload),
      { timeout: 5_000 },
    );
  }

  /** Send the "your invoice is ready" email. */
  async sendInvoiceEmail(params: InvoiceEmailParams): Promise<void> {
    await this.breaker.fire({
      from: this.from,
      to: params.to,
      subject: `Invoice ${params.invoiceNumber} from ${params.buyerCompany}`,
      html: this.renderInvoiceHtml(params),
    });
    this.logger.log(`Queued invoice email ${params.invoiceNumber} to ${params.to}`);
  }

  private async deliver(payload: CreateEmailOptions): Promise<void> {
    const { error } = await this.resend.emails.send(payload);
    if (error) {
      throw new Error(`Resend delivery failed: ${error.message}`);
    }
  }

  private renderInvoiceHtml(params: InvoiceEmailParams): string {
    const link = params.downloadUrl
      ? `<p><a href="${params.downloadUrl}">Download your invoice (PDF)</a></p>`
      : '<p>Your invoice PDF is available in your buyer portal.</p>';
    return [
      '<div style="font-family:Arial,Helvetica,sans-serif;color:#111827;font-size:14px;">',
      `<h2 style="margin:0 0 12px;">Invoice ${params.invoiceNumber}</h2>`,
      `<p>Hello ${params.buyerCompany},</p>`,
      `<p>A new invoice for <strong>${params.currency} ${params.total}</strong> is now available.</p>`,
      `<p>Payment is due by <strong>${params.dueDate}</strong>.</p>`,
      link,
      '<p style="color:#6b7280;font-size:12px;margin-top:24px;">Thank you for your business.</p>',
      '</div>',
    ].join('');
  }
}
