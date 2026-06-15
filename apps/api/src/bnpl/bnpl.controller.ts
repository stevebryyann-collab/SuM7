import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { Decimal } from 'decimal.js';
import { ClerkBuyerGuard, type BuyerAuthenticatedRequest } from '../auth/guards/clerk-buyer.guard';
import { PrismaService } from '../prisma/prisma.service';
import { MerchantContextService } from '../prisma/merchant-context.service';
import { BnplService } from './bnpl.service';
import type { BuyerProfileForBnpl, EligibilityResult, BnplWebhookEvent } from './bnpl.interfaces';

const Money = Decimal.clone({ rounding: Decimal.ROUND_HALF_EVEN, precision: 40 });

/** Request body for an eligibility check (buyer-facing; amount is a number). */
interface EligibilityBody {
  orderAmount: number;
}

/** Request body for initiating financing. */
interface InitiateBody {
  orderId: string;
  selectedTerms: number;
}

/** Minimal Resolve webhook envelope we decode before signature verification. */
interface ResolveWebhookBody {
  type?: string;
  event?: string;
  data?: { reference?: string; id?: string };
  reference?: string;
}

/**
 * BNPL HTTP surface.
 *
 *   Buyer portal (Clerk, approval required):
 *     POST /api/v1/buyer/bnpl/eligibility   check financing eligibility for an amount
 *     POST /api/v1/buyer/bnpl/initiate      start a financing session for an order
 *
 *   Provider callback (no guard, raw body, signature verified in the adapter):
 *     POST /api/v1/bnpl/resolve/webhook
 *
 * The webhook is excluded from the global ValidationPipe (it reads req.rawBody
 * via @Req) and from rate limiting (the RateLimitGuard skips webhook paths).
 */
@Controller('api/v1')
export class BnplController {
  constructor(
    private readonly bnpl: BnplService,
    private readonly prisma: PrismaService,
    private readonly merchantContext: MerchantContextService,
  ) {}

  // ── Buyer: eligibility ────────────────────────────────────────────────────

  @Post('buyer/bnpl/eligibility')
  @UseGuards(ClerkBuyerGuard)
  @HttpCode(HttpStatus.OK)
  async eligibility(
    @Req() req: BuyerAuthenticatedRequest,
    @Body() body: EligibilityBody,
  ): Promise<EligibilityResult> {
    const buyer = req.buyer!;
    if (typeof body.orderAmount !== 'number' || !Number.isFinite(body.orderAmount) || body.orderAmount <= 0) {
      throw new BadRequestException({
        code: 'INVALID_ORDER_AMOUNT',
        message: 'orderAmount must be a positive number',
      });
    }
    const orderAmount = new Money(body.orderAmount.toString());
    const profile = await this.loadBuyerProfile(buyer.buyerId, buyer.merchantId);
    return this.bnpl.checkEligibility(buyer.merchantId, {
      buyer: profile,
      orderAmount,
      currency: 'USD',
    });
  }

  // ── Buyer: initiate financing ─────────────────────────────────────────────

  @Post('buyer/bnpl/initiate')
  @UseGuards(ClerkBuyerGuard)
  @HttpCode(HttpStatus.OK)
  async initiate(
    @Req() req: BuyerAuthenticatedRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: InitiateBody,
  ): Promise<{ redirectUrl: string; expiresAt: string }> {
    const buyer = req.buyer!;
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new BadRequestException({
        code: 'MISSING_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key header is required',
      });
    }
    if (!body.orderId || typeof body.selectedTerms !== 'number') {
      throw new BadRequestException({
        code: 'INVALID_BODY',
        message: 'orderId and selectedTerms are required',
      });
    }

    const order = await this.merchantContext.run(buyer.merchantId, () =>
      this.prisma.order.findFirst({
        where: { id: body.orderId, merchantId: buyer.merchantId },
        select: {
          buyerId: true,
          total: true,
          currency: true,
          invoice: { select: { id: true } },
        },
      }),
    );
    if (!order) {
      throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
    }
    // Verify the order belongs to the requesting buyer.
    if (order.buyerId !== buyer.buyerId) {
      throw new ForbiddenException({ code: 'ORDER_NOT_OWNED', message: 'Order does not belong to you' });
    }
    if (!order.invoice) {
      throw new BadRequestException({
        code: 'NO_INVOICE_FOR_ORDER',
        message: 'Order has no invoice to finance yet',
      });
    }

    const profile = await this.loadBuyerProfile(buyer.buyerId, buyer.merchantId);
    const result = await this.bnpl.initiateFinancing(buyer.merchantId, {
      buyer: profile,
      invoiceId: order.invoice.id,
      orderId: body.orderId,
      amount: new Money(order.total.toString()),
      currency: order.currency,
      selectedTermDays: body.selectedTerms,
      idempotencyKey: idempotencyKey.trim(),
    });
    return { redirectUrl: result.redirectUrl, expiresAt: result.expiresAt };
  }

  // ── Provider webhook (no guard, raw body) ──────────────────────────────────

  @Post('bnpl/resolve/webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-resolve-signature') signature: string | undefined,
  ): Promise<{ received: true }> {
    const raw = req.rawBody;
    if (!raw) {
      throw new BadRequestException({ code: 'MISSING_RAW_BODY', message: 'Raw body unavailable' });
    }
    if (!signature) {
      throw new UnauthorizedException({
        code: 'MISSING_SIGNATURE',
        message: 'Missing Resolve signature header',
      });
    }

    const rawBody = raw.toString('utf8');
    let parsed: ResolveWebhookBody;
    try {
      parsed = JSON.parse(rawBody) as ResolveWebhookBody;
    } catch {
      throw new BadRequestException({ code: 'INVALID_PAYLOAD', message: 'Malformed webhook payload' });
    }

    const event: BnplWebhookEvent = {
      type: this.normalizeEventType(parsed.type ?? parsed.event),
      invoiceId: parsed.data?.reference ?? parsed.reference ?? null,
      referenceId: parsed.data?.id ?? null,
    };

    // The adapter verifies the HMAC signature before acting on the event.
    await this.bnpl.getAdapter('').handleWebhook(rawBody, signature, event);
    return { received: true };
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private normalizeEventType(raw: string | undefined): BnplWebhookEvent['type'] {
    switch (raw) {
      case 'PAYMENT_CONFIRMED':
      case 'charge.confirmed':
      case 'charge.paid':
        return 'PAYMENT_CONFIRMED';
      case 'PAYMENT_DEFAULTED':
      case 'charge.defaulted':
        return 'PAYMENT_DEFAULTED';
      default:
        return 'UNKNOWN';
    }
  }

  private async loadBuyerProfile(buyerId: string, merchantId: string): Promise<BuyerProfileForBnpl> {
    const buyer = await this.merchantContext.runAsSystem(() =>
      this.prisma.buyer.findUnique({
        where: { id: buyerId },
        select: { companyName: true, email: true, taxId: true },
      }),
    );
    if (!buyer) {
      throw new NotFoundException({ code: 'BUYER_NOT_FOUND', message: 'Buyer not found' });
    }
    const relationship = await this.merchantContext.run(merchantId, () =>
      this.prisma.merchantBuyerRelationship.findFirst({
        where: { merchantId, buyerId },
        select: { creditLimit: true, creditUsed: true },
      }),
    );
    return {
      buyerId,
      merchantId,
      companyName: buyer.companyName,
      email: buyer.email,
      taxId: buyer.taxId,
      creditLimit: relationship?.creditLimit ? new Money(relationship.creditLimit.toString()) : null,
      creditUsed: new Money((relationship?.creditUsed ?? 0).toString()),
    };
  }
}
