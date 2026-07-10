import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Resend, type CreateEmailOptions } from 'resend';
import type CircuitBreaker from 'opossum';
import * as Sentry from '@sentry/node';
import { AppConfigService } from '../config/app-config.service';
import { CircuitBreakerFactory } from '../common/circuit-breaker/circuit-breaker.factory';
import {
  renderInvoiceEmail,
  type InvoiceEmailModel,
} from './templates/invoice.email';
import {
  renderPaymentReminderEmail,
  type PaymentReminderEmailModel,
} from './templates/payment-reminder.email';
import {
  renderBuyerApprovalEmail,
  type BuyerApprovalEmailModel,
} from './templates/buyer-approval.email';
import {
  renderBuyerRejectionEmail,
  type BuyerRejectionEmailModel,
} from './templates/buyer-rejection.email';
import {
  renderMerchantNewApplicationEmail,
  type MerchantNewApplicationEmailModel,
} from './templates/merchant-new-application.email';
import {
  renderOrderShippedEmail,
  type OrderShippedEmailModel,
} from './templates/order-shipped.email';
import {
  renderStandingOrderReminderEmail,
  type StandingOrderReminderEmailModel,
} from './templates/standing-order-reminder.email';
import type { RenderedEmail, LineItemRow } from './templates/layout';

/** Uniform result for every email method. NEVER throws — failures are logged. */
export interface EmailSendResult {
  sent: boolean;
  messageId?: string;
}

// ── Public params (controllers/services build these) ──────────────────────

export interface InvoiceEmailParams {
  to: string;
  buyerCompany: string;
  merchantName: string;
  invoiceNumber: string;
  total: string;
  currency: string;
  dueDate: string;
  paymentTerms: string;
  presignedUrl: string | null;
  lineItems: LineItemRow[];
}

export interface PaymentReminderEmailParams {
  to: string;
  invoiceNumber: string;
  merchantName: string;
  merchantEmail: string;
  outstandingAmount: string;
  currency: string;
  dueDate: string;
  daysOverdue: number;
  reminderCount: 1 | 2 | 3;
  portalUrl: string | null;
}

export interface RegistrationConfirmEmailParams {
  to: string;
  applicantCompany: string;
  merchantName: string;
}

export interface BuyerApprovalEmailParams {
  to: string;
  buyerCompany: string;
  merchantName: string;
  paymentTermsLabel: string;
  pricingTierName: string | null;
  creditLimit: string | null;
  currency: string;
  portalUrl: string;
}

export interface BuyerRejectionEmailParams {
  to: string;
  buyerCompany: string;
  merchantName: string;
  merchantEmail: string;
  rejectionReason: string | null;
}

export interface MerchantApplicationAlertParams {
  to: string;
  applicantCompany: string;
  businessType: string | null;
  estimatedMonthlyOrder: string | null;
  reviewUrl: string;
}

export interface PaymentFailureAlertParams {
  to: string;
  merchantName: string;
  reason: string;
  amount: string;
  currency: string;
}

export interface VoidNotificationParams {
  to: string;
  buyerCompany: string;
  merchantName: string;
  invoiceNumber: string;
  reason: string;
}

export interface OrderShippedEmailParams {
  to: string;
  merchantName: string;
  orderNumber: string;
  carrierName: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
}

export interface StandingOrderReminderEmailParams {
  to: string;
  merchantName: string;
  buyerCompany: string;
  standingOrderName: string;
  frequencyLabel: string;
  portalUrl: string;
  manageUrl: string;
  lastOrder: { total: string; currency: string; lineItems: LineItemRow[] } | null;
}

interface DeliveryResult {
  messageId: string | null;
}

/**
 * Transactional email via Resend, wrapped in a circuit breaker so a Resend
 * outage fails fast instead of stalling workers. Every public method is
 * non-throwing: a delivery failure is reported to Sentry and surfaced as
 * `{ sent: false }` so an email problem never crashes a worker or request.
 */
@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend;
  private readonly from: string;
  private breaker!: CircuitBreaker<[CreateEmailOptions], DeliveryResult>;

  constructor(
    private readonly config: AppConfigService,
    private readonly breakerFactory: CircuitBreakerFactory,
  ) {
    this.resend = new Resend(this.config.get('RESEND_API_KEY'));
    this.from = this.config.get('RESEND_FROM_ADDRESS');
  }

  onModuleInit(): void {
    this.breaker = this.breakerFactory.create<[CreateEmailOptions], DeliveryResult>(
      'resend',
      (payload: CreateEmailOptions) => this.deliver(payload),
      { timeout: 5_000 },
    );
  }

  // ── Public API ──────────────────────────────────────────────────────────

  async sendInvoiceEmail(params: InvoiceEmailParams): Promise<EmailSendResult> {
    const model: InvoiceEmailModel = {
      invoiceNumber: params.invoiceNumber,
      merchantName: params.merchantName,
      buyerCompany: params.buyerCompany,
      total: params.total,
      currency: params.currency,
      dueDate: params.dueDate,
      paymentTerms: params.paymentTerms,
      presignedUrl: params.presignedUrl,
      lineItems: params.lineItems,
    };
    return this.send(params.to, renderInvoiceEmail(model), 'invoice', params.merchantName);
  }

  async sendPaymentReminderEmail(params: PaymentReminderEmailParams): Promise<EmailSendResult> {
    const model: PaymentReminderEmailModel = {
      invoiceNumber: params.invoiceNumber,
      merchantName: params.merchantName,
      merchantEmail: params.merchantEmail,
      outstandingAmount: params.outstandingAmount,
      currency: params.currency,
      dueDate: params.dueDate,
      daysOverdue: params.daysOverdue,
      reminderCount: params.reminderCount,
      portalUrl: params.portalUrl,
    };
    return this.send(params.to, renderPaymentReminderEmail(model), 'payment_reminder', params.merchantName);
  }

  async sendBuyerRegistrationConfirmation(
    params: RegistrationConfirmEmailParams,
  ): Promise<EmailSendResult> {
    const rendered: RenderedEmail = {
      subject: `We received your application — ${params.merchantName}`,
      html: this.simpleLayout(
        'Application received',
        `Hello ${params.applicantCompany}, we've received your trade account application to ${params.merchantName}. ` +
          `We'll review it and send a decision — typically within 1 business day. ` +
          `You'll receive an email once a decision has been made.`,
      ),
    };
    return this.send(params.to, rendered, 'registration_confirm', params.merchantName);
  }

  async sendBuyerApprovalEmail(params: BuyerApprovalEmailParams): Promise<EmailSendResult> {
    const model: BuyerApprovalEmailModel = {
      buyerCompany: params.buyerCompany,
      merchantName: params.merchantName,
      paymentTermsLabel: params.paymentTermsLabel,
      pricingTierName: params.pricingTierName,
      creditLimit: params.creditLimit,
      currency: params.currency,
      portalUrl: params.portalUrl,
    };
    return this.send(params.to, renderBuyerApprovalEmail(model), 'buyer_approval', params.merchantName);
  }

  async sendBuyerRejectionEmail(params: BuyerRejectionEmailParams): Promise<EmailSendResult> {
    const model: BuyerRejectionEmailModel = {
      buyerCompany: params.buyerCompany,
      merchantName: params.merchantName,
      merchantEmail: params.merchantEmail,
      rejectionReason: params.rejectionReason,
    };
    return this.send(params.to, renderBuyerRejectionEmail(model), 'buyer_rejection', params.merchantName);
  }

  async sendMerchantNewApplicationAlert(
    params: MerchantApplicationAlertParams,
  ): Promise<EmailSendResult> {
    const model: MerchantNewApplicationEmailModel = {
      applicantCompany: params.applicantCompany,
      businessType: params.businessType,
      estimatedMonthlyOrder: params.estimatedMonthlyOrder,
      reviewUrl: params.reviewUrl,
    };
    return this.send(params.to, renderMerchantNewApplicationEmail(model), 'merchant_new_application');
  }

  async sendMerchantPaymentFailureAlert(params: PaymentFailureAlertParams): Promise<EmailSendResult> {
    const rendered: RenderedEmail = {
      subject: `Action required: a payment failed`,
      html: this.simpleLayout(
        'Payment failed',
        `Hello ${params.merchantName}, a payment of ${params.currency} ${params.amount} could not be processed ` +
          `(${params.reason}). Please review your billing settings to avoid service interruption.`,
      ),
    };
    return this.send(params.to, rendered, 'merchant_payment_failure');
  }

  async sendInvoiceVoidNotification(params: VoidNotificationParams): Promise<EmailSendResult> {
    const rendered: RenderedEmail = {
      subject: `Invoice ${params.invoiceNumber} has been voided`,
      html: this.simpleLayout(
        'Invoice voided',
        `Hello ${params.buyerCompany}, invoice #${params.invoiceNumber} from ${params.merchantName} has been voided ` +
          `(${params.reason}). No payment is due on this invoice. A corrected invoice may follow.`,
      ),
    };
    return this.send(params.to, rendered, 'invoice_void', params.merchantName);
  }

  async sendOrderShippedEmail(params: OrderShippedEmailParams): Promise<EmailSendResult> {
    const model: OrderShippedEmailModel = {
      merchantName: params.merchantName,
      orderNumber: params.orderNumber,
      carrierName: params.carrierName,
      trackingNumber: params.trackingNumber,
      trackingUrl: params.trackingUrl,
    };
    return this.send(params.to, renderOrderShippedEmail(model), 'order_shipped', params.merchantName);
  }

  async sendStandingOrderReminderEmail(
    params: StandingOrderReminderEmailParams,
  ): Promise<EmailSendResult> {
    const model: StandingOrderReminderEmailModel = {
      merchantName: params.merchantName,
      buyerCompany: params.buyerCompany,
      standingOrderName: params.standingOrderName,
      frequencyLabel: params.frequencyLabel,
      portalUrl: params.portalUrl,
      manageUrl: params.manageUrl,
      lastOrder: params.lastOrder,
    };
    return this.send(params.to, renderStandingOrderReminderEmail(model), 'standing_order_reminder', params.merchantName);
  }

  // ── Internals ─────────────────────────────────────────────────────────

  /** The bare sender address from RESEND_FROM_ADDRESS ("Name <addr>" or "addr"). */
  private senderAddress(): string {
    const match = this.from.match(/<([^>]+)>/);
    return match && match[1] ? match[1] : this.from;
  }

  /**
   * Build the `from` header. Buyer-facing mail is sent as "{merchantName} Trade"
   * so it reads as the merchant's own trade desk (e.g. "Acme Brand Trade"), never
   * the platform. Merchant-facing alerts pass no name and use the default sender.
   */
  private fromFor(merchantName?: string): string {
    if (!merchantName || merchantName.trim().length === 0) return this.from;
    const safe = merchantName.trim().replace(/["\r\n]/g, '');
    return `"${safe} Trade" <${this.senderAddress()}>`;
  }

  private async send(
    to: string,
    rendered: RenderedEmail,
    kind: string,
    fromName?: string,
  ): Promise<EmailSendResult> {
    try {
      const result = await this.breaker.fire({
        from: this.fromFor(fromName),
        to,
        subject: rendered.subject,
        html: rendered.html,
      });
      this.logger.log(`Sent ${kind} email to ${to} (${result.messageId ?? 'no-id'})`);
      return result.messageId ? { sent: true, messageId: result.messageId } : { sent: true };
    } catch (error) {
      Sentry.captureException(error, {
        level: 'error',
        tags: { component: 'email', kind },
        extra: { to },
      });
      this.logger.error(`Failed to send ${kind} email to ${to}: ${(error as Error).message}`);
      return { sent: false };
    }
  }

  private async deliver(payload: CreateEmailOptions): Promise<DeliveryResult> {
    const { data, error } = await this.resend.emails.send(payload);
    if (error) {
      throw new Error(`Resend delivery failed: ${error.message}`);
    }
    return { messageId: data?.id ?? null };
  }

  private simpleLayout(heading: string, paragraph: string): string {
    const safe = paragraph
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return [
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head>',
      '<body style="margin:0;padding:0;background:#FFFFFF;">',
      '<table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center">',
      '<table role="presentation" cellpadding="0" cellspacing="0" width="600" ',
      'style="max-width:600px;width:100%;font-family:Arial,Helvetica,sans-serif;padding:32px 24px;"><tr><td>',
      `<h1 style="margin:0 0 16px;color:#111827;font-size:20px;font-weight:700;">${heading}</h1>`,
      `<p style="margin:0;color:#111827;font-size:14px;line-height:1.5;">${safe}</p>`,
      '</td></tr></table></td></tr></table></body></html>',
    ].join('');
  }
}
