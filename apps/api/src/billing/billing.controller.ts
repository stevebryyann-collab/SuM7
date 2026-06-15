import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
  type RawBodyRequest,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import type Stripe from 'stripe';
import { BillingTierSchema, type BillingTierInput, type SubscriptionTier } from '@b2b/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  MerchantSessionGuard,
  type MerchantAuthenticatedRequest,
} from '../auth/guards/merchant-session.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AppConfigService } from '../config/app-config.service';
import { BillingService } from './billing.service';

/**
 * Stripe billing HTTP surface.
 *
 *   Merchant admin (NextAuth):
 *     POST /api/v1/billing/subscribe     create the hybrid subscription (owner)
 *     POST /api/v1/billing/change-tier   switch flat-price tier (owner)
 *     GET  /api/v1/billing/portal        Stripe Billing Portal URL (owner)
 *     GET  /api/v1/billing/usage         current-month GMV usage (all roles)
 *
 *   Stripe callback (no guard, raw body, signature verified in controller):
 *     POST /api/v1/billing/webhook       @SkipThrottle, excluded from ValidationPipe
 */
@Controller('api/v1/billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly config: AppConfigService,
  ) {}

  @Post('subscribe')
  @UseGuards(MerchantSessionGuard, RolesGuard)
  @Roles('owner')
  @HttpCode(HttpStatus.CREATED)
  async subscribe(
    @Req() req: MerchantAuthenticatedRequest,
    @Body(new ZodValidationPipe(BillingTierSchema)) dto: BillingTierInput,
  ): Promise<{ subscriptionId: string; status: string }> {
    const subscription = await this.billing.createSubscription(
      req.merchant!.merchantId,
      dto.tier,
      req.merchant!.userId,
    );
    return { subscriptionId: subscription.id, status: subscription.status };
  }

  @Post('change-tier')
  @UseGuards(MerchantSessionGuard, RolesGuard)
  @Roles('owner')
  @HttpCode(HttpStatus.OK)
  async changeTier(
    @Req() req: MerchantAuthenticatedRequest,
    @Body(new ZodValidationPipe(BillingTierSchema)) dto: BillingTierInput,
  ): Promise<{ subscriptionId: string; tier: SubscriptionTier }> {
    const subscription = await this.billing.changeTier(
      req.merchant!.merchantId,
      dto.tier,
      req.merchant!.userId,
    );
    return { subscriptionId: subscription.id, tier: dto.tier };
  }

  @Get('portal')
  @UseGuards(MerchantSessionGuard, RolesGuard)
  @Roles('owner')
  async portal(@Req() req: MerchantAuthenticatedRequest): Promise<{ url: string }> {
    const returnUrl = `https://${this.config.get('PLATFORM_DOMAIN')}/merchant/billing`;
    const url = await this.billing.createBillingPortalSession(req.merchant!.merchantId, returnUrl);
    return { url };
  }

  @Get('usage')
  @UseGuards(MerchantSessionGuard, RolesGuard)
  async usage(@Req() req: MerchantAuthenticatedRequest): Promise<{
    tier: SubscriptionTier;
    gmvCurrentMonth: string;
    freeThreshold: string;
    billableGmv: string;
    estimatedFee: string;
  }> {
    return this.billing.getUsage(req.merchant!.merchantId);
  }

  @Post('webhook')
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  async webhook(
    @Req() req: RawBodyRequest<Request>,
  ): Promise<{ received: true }> {
    const raw = req.rawBody;
    if (!raw) {
      throw new BadRequestException({ code: 'MISSING_RAW_BODY', message: 'Raw body unavailable' });
    }
    const signature = req.headers['stripe-signature'];
    if (typeof signature !== 'string') {
      throw new UnauthorizedException({
        code: 'MISSING_SIGNATURE',
        message: 'Missing Stripe-Signature header',
      });
    }

    let event: Stripe.Event;
    try {
      event = this.billing.constructEvent(raw, signature);
    } catch (error) {
      throw new UnauthorizedException({
        code: 'INVALID_SIGNATURE',
        message: `Stripe signature verification failed: ${(error as Error).message}`,
      });
    }

    await this.billing.handleStripeWebhook(event);
    return { received: true };
  }
}
