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
} from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { Request } from "express";
import type { EventEntity } from "@paddle/paddle-node-sdk";
import { BillingTierSchema, type BillingTierInput } from "@b2b/shared";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import {
  MerchantSessionGuard,
  type MerchantAuthenticatedRequest,
} from "../auth/guards/merchant-session.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import {
  BillingService,
  type BillingPlan,
  type ChangeTierResult,
} from "./billing.service";

/**
 * Paddle billing HTTP surface.
 *
 *   Merchant admin (NextAuth):
 *     POST /api/v1/billing/subscribe            first subscribe / change tier (owner)
 *     POST /api/v1/billing/change-tier          change tier (owner)
 *     POST /api/v1/billing/change-plan          change tier — billing-page alias (owner)
 *     GET  /api/v1/billing/portal               Paddle customer-portal URL (owner)
 *     POST /api/v1/billing/create-portal-session Paddle customer-portal URL (owner)
 *     GET  /api/v1/billing/usage                current-month GMV usage (all roles)
 *     GET  /api/v1/billing/plan                 current plan snapshot (all roles)
 *
 * A tier mutation returns `{ checkoutUrl }` when the merchant has no Paddle
 * subscription yet (Paddle can't create one server-side — the buyer completes a
 * hosted checkout), or `{ tier }` when an existing subscription is changed in
 * place with immediate proration.
 *
 *   Paddle callback (no guard, raw body, signature verified in controller):
 *     POST /api/v1/billing/webhook       @SkipThrottle, excluded from ValidationPipe
 */
@Controller("api/v1/billing")
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post("subscribe")
  @UseGuards(MerchantSessionGuard, RolesGuard)
  @Roles("owner")
  @HttpCode(HttpStatus.OK)
  async subscribe(
    @Req() req: MerchantAuthenticatedRequest,
    @Body(new ZodValidationPipe(BillingTierSchema)) dto: BillingTierInput,
  ): Promise<ChangeTierResult> {
    return this.billing.changeTier(
      req.merchant!.merchantId,
      dto.tier,
      req.merchant!.userId,
    );
  }

  @Post("change-tier")
  @UseGuards(MerchantSessionGuard, RolesGuard)
  @Roles("owner")
  @HttpCode(HttpStatus.OK)
  async changeTier(
    @Req() req: MerchantAuthenticatedRequest,
    @Body(new ZodValidationPipe(BillingTierSchema)) dto: BillingTierInput,
  ): Promise<ChangeTierResult> {
    return this.billing.changeTier(
      req.merchant!.merchantId,
      dto.tier,
      req.merchant!.userId,
    );
  }

  @Get("portal")
  @UseGuards(MerchantSessionGuard, RolesGuard)
  @Roles("owner")
  async portal(
    @Req() req: MerchantAuthenticatedRequest,
  ): Promise<{ url: string }> {
    const url = await this.billing.createBillingPortalSession(
      req.merchant!.merchantId,
    );
    return { url };
  }

  @Get("usage")
  @UseGuards(MerchantSessionGuard, RolesGuard)
  async usage(@Req() req: MerchantAuthenticatedRequest): Promise<{
    tier: string;
    gmvCurrentMonth: string;
    freeThreshold: string;
    billableGmv: string;
    estimatedFee: string;
  }> {
    return this.billing.getUsage(req.merchant!.merchantId);
  }

  // ── Stage 4 billing-page aliases ────────────────────────────────────────

  @Get("plan")
  @UseGuards(MerchantSessionGuard, RolesGuard)
  plan(@Req() req: MerchantAuthenticatedRequest): Promise<BillingPlan> {
    return this.billing.getPlan(req.merchant!.merchantId);
  }

  /**
   * Alias for the billing page's "Change plan" action. Returns `{ checkoutUrl }`
   * for a first subscription (opened in a new tab) or `{ tier }` for an in-place
   * prorated change.
   */
  @Post("change-plan")
  @UseGuards(MerchantSessionGuard, RolesGuard)
  @Roles("owner")
  @HttpCode(HttpStatus.OK)
  async changePlan(
    @Req() req: MerchantAuthenticatedRequest,
    @Body(new ZodValidationPipe(BillingTierSchema)) dto: BillingTierInput,
  ): Promise<ChangeTierResult> {
    return this.billing.changeTier(
      req.merchant!.merchantId,
      dto.tier,
      req.merchant!.userId,
    );
  }

  /** Alias for the billing page's "Manage billing" button (Paddle portal URL). */
  @Post("create-portal-session")
  @UseGuards(MerchantSessionGuard, RolesGuard)
  @Roles("owner")
  @HttpCode(HttpStatus.OK)
  async createPortalSession(
    @Req() req: MerchantAuthenticatedRequest,
  ): Promise<{ url: string }> {
    const url = await this.billing.createBillingPortalSession(
      req.merchant!.merchantId,
    );
    return { url };
  }

  @Post("webhook")
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  async webhook(
    @Req() req: RawBodyRequest<Request>,
  ): Promise<{ received: true }> {
    const raw = req.rawBody;
    if (!raw) {
      throw new BadRequestException({
        code: "MISSING_RAW_BODY",
        message: "Raw body unavailable",
      });
    }
    const signature = req.headers["paddle-signature"];
    if (typeof signature !== "string") {
      throw new UnauthorizedException({
        code: "MISSING_SIGNATURE",
        message: "Missing Paddle-Signature header",
      });
    }

    let event: EventEntity;
    try {
      event = await this.billing.constructEvent(raw, signature);
    } catch (error) {
      throw new UnauthorizedException({
        code: "INVALID_SIGNATURE",
        message: `Paddle signature verification failed: ${(error as Error).message}`,
      });
    }

    await this.billing.handleWebhook(event);
    return { received: true };
  }
}
