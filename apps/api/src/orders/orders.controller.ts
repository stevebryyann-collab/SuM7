import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  BulkOrderSchema,
  CursorPaginationSchema,
  type BulkOrderInput,
  type CursorPaginationInput,
} from '@b2b/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { MerchantSessionGuard, type MerchantAuthenticatedRequest } from '../auth/guards/merchant-session.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ClerkBuyerGuard, type BuyerAuthenticatedRequest } from '../auth/guards/clerk-buyer.guard';
import {
  OrdersService,
  type OrderCreatedResult,
  type OrderDetail,
  type OrderFilters,
  type OrderSummary,
} from './orders.service';
import type { PaginatedResponse } from '@b2b/shared';

/**
 * Order HTTP surface. Two distinct audiences, two distinct guards (never mixed):
 *
 *   Buyer portal (Clerk):
 *     POST /buyer/orders        place a server-priced bulk order (idempotent)
 *     GET  /buyer/orders        the buyer's own orders (cursor paginated)
 *     GET  /buyer/orders/:id    one of the buyer's own orders
 *
 *   Merchant admin (NextAuth):
 *     GET  /orders              all of the merchant's orders (filterable)
 *     GET  /orders/:id          one order with full line-item + invoice detail
 *
 * The buyer's tenant is the merchant resolved by {@link ClerkBuyerGuard} from the
 * App-Proxy cookie — never a client-supplied id. `POST /buyer/orders` requires an
 * `Idempotency-Key` header; the global IdempotencyMiddleware owns replay caching.
 */
@Controller()
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  // ── Buyer portal ────────────────────────────────────────────────────────

  @Post('buyer/orders')
  @UseGuards(ClerkBuyerGuard)
  @HttpCode(HttpStatus.CREATED)
  createOrder(
    @Req() req: BuyerAuthenticatedRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(BulkOrderSchema)) dto: BulkOrderInput,
  ): Promise<OrderCreatedResult> {
    const buyer = req.buyer!;
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'An Idempotency-Key header is required to place an order',
      });
    }
    // The buyer's merchant is authoritative (the App-Proxy cookie), not the body.
    return this.orders.createBulkOrder(buyer.buyerId, buyer.merchantId, dto, idempotencyKey.trim());
  }

  @Get('buyer/orders')
  @UseGuards(ClerkBuyerGuard)
  listBuyerOrders(
    @Req() req: BuyerAuthenticatedRequest,
    @Query(new ZodValidationPipe(CursorPaginationSchema)) query: CursorPaginationInput,
  ): Promise<PaginatedResponse<OrderSummary>> {
    const buyer = req.buyer!;
    return this.orders.getOrdersForBuyer(buyer.buyerId, buyer.merchantId, {
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Get('buyer/orders/:id')
  @UseGuards(ClerkBuyerGuard)
  getBuyerOrder(
    @Req() req: BuyerAuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<OrderDetail> {
    const buyer = req.buyer!;
    return this.orders.getOrderDetail(buyer.merchantId, id, buyer.buyerId);
  }

  // ── Merchant admin ──────────────────────────────────────────────────────

  @Get('orders')
  @UseGuards(MerchantSessionGuard, RolesGuard)
  listMerchantOrders(
    @Req() req: MerchantAuthenticatedRequest,
    @Query(new ZodValidationPipe(CursorPaginationSchema)) query: CursorPaginationInput,
    @Query('status') status?: string,
    @Query('buyerId') buyerId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ): Promise<PaginatedResponse<OrderSummary>> {
    const merchant = req.merchant!;
    const filters: OrderFilters = { status, buyerId, dateFrom, dateTo };
    return this.orders.getOrdersForMerchant(merchant.merchantId, {
      cursor: query.cursor,
      limit: query.limit,
      ...filters,
    });
  }

  @Get('orders/:id')
  @UseGuards(MerchantSessionGuard, RolesGuard)
  getMerchantOrder(
    @Req() req: MerchantAuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<OrderDetail> {
    const merchant = req.merchant!;
    return this.orders.getOrderDetail(merchant.merchantId, id);
  }
}
