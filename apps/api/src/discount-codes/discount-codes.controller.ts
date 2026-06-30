import { Controller, Get, Post, Patch, Query, Body, Param, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ClerkBuyerGuard, type BuyerAuthenticatedRequest } from '../auth/guards/clerk-buyer.guard';
import { MerchantSessionGuard, type MerchantAuthenticatedRequest } from '../auth/guards/merchant-session.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DiscountCodesService, type DiscountValidationResult, type DiscountCodeStats } from './discount-codes.service';
import type { B2bDiscountCode } from '@prisma/client';
import Decimal from 'decimal.js';

const ValidateCodeSchema = z.object({
  code: z.string().trim().min(1).max(50),
  orderTotal: z.number().positive(),
});

const CreateCodeSchema = z.object({
  code: z.string().trim().min(1).max(50),
  description: z.string().max(255).optional(),
  discountType: z.enum(['pct_off', 'fixed_amount']),
  discountValue: z.number().positive(),
  minOrderAmount: z.number().positive().optional(),
  maxUses: z.number().int().positive().optional(),
  validFrom: z.string().datetime().optional().transform((val) => (val ? new Date(val) : undefined)),
  validTo: z.string().datetime().optional().transform((val) => (val ? new Date(val) : undefined)),
  appliesTo: z.string().max(50).optional(),
});

const ListCodesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

@Controller()
export class DiscountCodesController {
  constructor(private readonly service: DiscountCodesService) {}

  // Buyer routes
  @Post('buyer/discount-codes/validate')
  @UseGuards(ClerkBuyerGuard)
  async validateCode(
    @Req() req: BuyerAuthenticatedRequest,
    @Body(new ZodValidationPipe(ValidateCodeSchema)) body: z.infer<typeof ValidateCodeSchema>,
  ): Promise<DiscountValidationResult> {
    const { merchantId } = req.buyer!;
    const correlationId = req.headers['x-correlation-id'] as string | undefined;
    const orderTotal = new Decimal(body.orderTotal);

    return this.service.validateCode(merchantId, body.code, orderTotal, correlationId);
  }

  // Merchant routes
  @Get('discount-codes')
  @UseGuards(MerchantSessionGuard)
  async listCodes(
    @Req() req: MerchantAuthenticatedRequest,
    @Query(new ZodValidationPipe(ListCodesQuerySchema)) query: z.infer<typeof ListCodesQuerySchema>,
  ): Promise<{ codes: B2bDiscountCode[]; nextCursor: string | null }> {
    const { merchantId } = req.merchant!;
    return this.service.listCodes(merchantId, query.cursor, query.limit);
  }

  @Post('discount-codes')
  @UseGuards(MerchantSessionGuard, RolesGuard)
  @Roles('owner', 'admin')
  async createCode(
    @Req() req: MerchantAuthenticatedRequest,
    @Body(new ZodValidationPipe(CreateCodeSchema)) body: z.infer<typeof CreateCodeSchema>,
  ): Promise<B2bDiscountCode> {
    const { merchantId, userId } = req.merchant!;
    const correlationId = req.headers['x-correlation-id'] as string | undefined;
    return this.service.createCode(merchantId, body, userId, correlationId);
  }

  @Patch('discount-codes/:id/deactivate')
  @UseGuards(MerchantSessionGuard, RolesGuard)
  @Roles('owner', 'admin')
  async deactivateCode(
    @Req() req: MerchantAuthenticatedRequest,
    @Param('id') codeId: string,
  ): Promise<void> {
    const { merchantId } = req.merchant!;
    const correlationId = req.headers['x-correlation-id'] as string | undefined;
    return this.service.deactivateCode(codeId, merchantId, correlationId);
  }

  @Get('discount-codes/:id/stats')
  @UseGuards(MerchantSessionGuard)
  async getCodeStats(
    @Req() req: MerchantAuthenticatedRequest,
    @Param('id') codeId: string,
  ): Promise<DiscountCodeStats> {
    const { merchantId } = req.merchant!;
    return this.service.getCodeStats(codeId, merchantId);
  }
}
