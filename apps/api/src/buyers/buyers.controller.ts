import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApproveBuyerSchema,
  BuyerRegisterApplicationSchema,
  CursorPaginationSchema,
  RejectBuyerSchema,
  type ApproveBuyerInput,
  type BuyerRegisterApplicationInput,
  type CursorPaginationInput,
  type PaginatedResponse,
  type RejectBuyerInput,
} from '@b2b/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  MerchantSessionGuard,
  type MerchantAuthenticatedRequest,
} from '../auth/guards/merchant-session.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  ClerkAuthenticatedGuard,
  type BuyerIdentityRequest,
} from '../auth/guards/clerk-authenticated.guard';
import {
  BuyersService,
  type ApplicationResult,
  type BuyerSummary,
} from './buyers.service';

/** Read one cookie from the raw header (App Proxy sets `__merchant_id`). */
function readCookie(req: Request, name: string): string | null {
  const cookies = req.headers.cookie;
  if (!cookies) return null;
  for (const part of cookies.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/** Buyer filters for the merchant list endpoint (validated loosely; ids checked in service). */
interface BuyerListQuery {
  approvalStatus?: string;
  pricingTierId?: string;
  searchQuery?: string;
}

/**
 * Buyer registration + approval HTTP surface.
 *
 *   Buyer (pre-approval, Clerk authenticated but not yet approved):
 *     POST /buyer/apply                       submit a registration application
 *
 *   Merchant admin (NextAuth):
 *     GET  /buyers                            list buyers with aggregates
 *     POST /buyers/applications/:id/approve   approve a pending application
 *     POST /buyers/applications/:id/reject    reject a pending application
 *     POST /buyers/:buyerId/suspend           suspend an approved buyer
 *
 * GDPR export/erasure live on the data-export surface (analytics controller).
 * Paths are bare (no /api/v1 prefix) to match the convention established by the
 * orders/invoices controllers in earlier prompts.
 */
@Controller()
export class BuyersController {
  constructor(private readonly buyers: BuyersService) {}

  // ── Buyer: pre-approval application ──────────────────────────────────────

  @Post('buyer/apply')
  @UseGuards(ClerkAuthenticatedGuard)
  @HttpCode(HttpStatus.CREATED)
  apply(
    @Req() req: BuyerIdentityRequest,
    @Body(new ZodValidationPipe(BuyerRegisterApplicationSchema)) dto: BuyerRegisterApplicationInput,
  ): Promise<ApplicationResult> {
    const identity = req.buyerIdentity;
    if (!identity) {
      throw new UnauthorizedException({ code: 'MISSING_TOKEN', message: 'Not authenticated' });
    }
    const merchantId = readCookie(req, '__merchant_id');
    if (!merchantId) {
      throw new UnauthorizedException({
        code: 'NO_MERCHANT_CONTEXT',
        message: 'Missing merchant context cookie',
      });
    }
    const ipAddress = req.ip ?? 'unknown';
    const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : 'unknown';
    return this.buyers.submitRegistrationApplication(
      merchantId,
      identity.clerkUserId,
      dto,
      ipAddress,
      userAgent,
    );
  }

  // ── Merchant: buyers list ────────────────────────────────────────────────

  @Get('buyers')
  @UseGuards(MerchantSessionGuard, RolesGuard)
  listBuyers(
    @Req() req: MerchantAuthenticatedRequest,
    @Query(new ZodValidationPipe(CursorPaginationSchema)) page: CursorPaginationInput,
    @Query() query: BuyerListQuery,
  ): Promise<PaginatedResponse<BuyerSummary>> {
    return this.buyers.listBuyersForMerchant(req.merchant!.merchantId, {
      ...page,
      approvalStatus: query.approvalStatus,
      pricingTierId: query.pricingTierId,
      searchQuery: query.searchQuery,
    });
  }

  // ── Merchant: approval workflow ──────────────────────────────────────────

  @Post('buyers/applications/:id/approve')
  @UseGuards(MerchantSessionGuard, RolesGuard)
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  approve(
    @Req() req: MerchantAuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(new ZodValidationPipe(ApproveBuyerSchema)) dto: ApproveBuyerInput,
  ): Promise<void> {
    return this.buyers.approveApplication(id, req.merchant!.merchantId, dto, req.merchant!.userId);
  }

  @Post('buyers/applications/:id/reject')
  @UseGuards(MerchantSessionGuard, RolesGuard)
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  reject(
    @Req() req: MerchantAuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(new ZodValidationPipe(RejectBuyerSchema)) dto: RejectBuyerInput,
  ): Promise<void> {
    return this.buyers.rejectApplication(id, req.merchant!.merchantId, dto, req.merchant!.userId);
  }

  // ── Merchant: suspension ─────────────────────────────────────────────────

  @Post('buyers/:buyerId/suspend')
  @UseGuards(MerchantSessionGuard, RolesGuard)
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  suspend(
    @Req() req: MerchantAuthenticatedRequest,
    @Param('buyerId', new ParseUUIDPipe({ version: '4' })) buyerId: string,
  ): Promise<void> {
    return this.buyers.suspendBuyer(buyerId, req.merchant!.merchantId, req.merchant!.userId);
  }
}
