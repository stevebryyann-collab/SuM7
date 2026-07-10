import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  MerchantSessionGuard,
  type MerchantAuthenticatedRequest,
} from '../auth/guards/merchant-session.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  SalesRepService,
  type RepBuyerListItem,
  type RepBuyerOrderItem,
} from '../auth/services/sales-rep.service';

const StartSessionSchema = z.object({
  buyerId: z.string().uuid(),
});

const ListBuyersQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().trim().max(255).optional(),
});

const BuyerOrdersQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

interface StartSessionResponse {
  sessionToken: string;
  expiresAt: string;
  buyerCompanyName: string;
  buyerEmail: string;
}

/**
 * Merchant-side sales-rep portal. Every route requires a merchant session and
 * one of the `sales_rep` / `admin` / `owner` roles. The actual order placement
 * happens on the buyer portal once a session token is minted here — see
 * {@link SalesRepSessionGuard}.
 */
@Controller('rep')
@UseGuards(MerchantSessionGuard, RolesGuard)
@Roles('sales_rep', 'admin', 'owner')
export class SalesRepController {
  constructor(private readonly salesRep: SalesRepService) {}

  @Post('sessions')
  async startSession(
    @Req() req: MerchantAuthenticatedRequest,
    @Body(new ZodValidationPipe(StartSessionSchema)) body: z.infer<typeof StartSessionSchema>,
  ): Promise<StartSessionResponse> {
    const { merchantId, userId } = req.merchant!;
    const result = await this.salesRep.startImpersonation(userId, merchantId, body.buyerId);
    return {
      sessionToken: result.sessionToken,
      expiresAt: result.expiresAt,
      buyerCompanyName: result.buyerInfo.companyName,
      buyerEmail: result.buyerInfo.email,
    };
  }

  @Delete('sessions/:sessionToken')
  async endSession(
    @Req() req: MerchantAuthenticatedRequest,
    @Param('sessionToken') sessionToken: string,
  ): Promise<{ ended: true }> {
    const { merchantId } = req.merchant!;
    await this.salesRep.endImpersonation(sessionToken, merchantId);
    return { ended: true };
  }

  @Get('buyers')
  async listBuyers(
    @Req() req: MerchantAuthenticatedRequest,
    @Query(new ZodValidationPipe(ListBuyersQuerySchema)) query: z.infer<typeof ListBuyersQuerySchema>,
  ): Promise<{ buyers: RepBuyerListItem[]; nextCursor: string | null }> {
    const { merchantId } = req.merchant!;
    return this.salesRep.listBuyers(merchantId, query.cursor, query.limit, query.search);
  }

  @Get('buyers/:buyerId/orders')
  async listBuyerOrders(
    @Req() req: MerchantAuthenticatedRequest,
    @Param('buyerId') buyerId: string,
    @Query(new ZodValidationPipe(BuyerOrdersQuerySchema)) query: z.infer<typeof BuyerOrdersQuerySchema>,
  ): Promise<{ orders: RepBuyerOrderItem[]; nextCursor: string | null }> {
    const { merchantId } = req.merchant!;
    return this.salesRep.listBuyerOrders(merchantId, buyerId, query.cursor, query.limit);
  }
}
