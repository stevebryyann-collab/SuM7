import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { z } from 'zod';
import {
  CursorPaginationSchema,
  MarkPaidSchema,
  type CursorPaginationInput,
  type MarkPaidInput,
  type InvoiceStatus,
  type PaginatedResponse,
} from '@b2b/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { REDIS_CACHE } from '../redis/redis.module';
import { MerchantSessionGuard, type MerchantAuthenticatedRequest } from '../auth/guards/merchant-session.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ClerkBuyerGuard, type BuyerAuthenticatedRequest } from '../auth/guards/clerk-buyer.guard';
import {
  InvoicesService,
  type ArAgingResult,
  type IntegrityResult,
  type InvoiceSummary,
} from './invoices.service';

/** Body of `PATCH /invoices/:id/void` — a required, human-readable reason. */
const VoidInvoiceSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
});
type VoidInvoiceInput = z.infer<typeof VoidInvoiceSchema>;

const RESEND_WINDOW_SECONDS = 300; // one resend per invoice per 5 minutes

/**
 * Invoicing & AR HTTP surface.
 *
 *   Merchant admin (NextAuth):
 *     GET   /invoices                   invoice list (cursor; status/aging/buyer)
 *     GET   /invoices/ar-aging          AR-aging report (5 zero-filled buckets)
 *     GET   /invoices/:id/integrity     verify the stored PDF SHA-256
 *     PATCH /invoices/:id/mark-paid     record a (partial) payment
 *     PATCH /invoices/:id/void          void an unpaid invoice
 *     POST  /invoices/:id/resend        re-send the invoice email (rate-limited)
 *
 *   Buyer portal (Clerk):
 *     GET   /buyer/invoices                the buyer's own invoices (cursor)
 *     GET   /buyer/invoices/:id/download   presigned PDF URL (ownership-checked)
 *
 * Mutating + void actions require an elevated merchant role; the buyer download
 * route enforces ownership inside the service.
 */
@Controller()
export class InvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    @Inject(REDIS_CACHE) private readonly cache: Redis,
  ) {}

  // ── Merchant admin ──────────────────────────────────────────────────────

  @Get('invoices')
  @UseGuards(MerchantSessionGuard, RolesGuard)
  listInvoices(
    @Req() req: MerchantAuthenticatedRequest,
    @Query(new ZodValidationPipe(CursorPaginationSchema)) page: CursorPaginationInput,
    @Query('status') status?: string,
    @Query('agingBucket') agingBucket?: string,
    @Query('buyerId') buyerId?: string,
  ): Promise<PaginatedResponse<InvoiceSummary>> {
    return this.invoices.listInvoicesForMerchant(req.merchant!.merchantId, {
      ...page,
      status,
      agingBucket,
      buyerId,
    });
  }

  @Get('invoices/ar-aging')
  @UseGuards(MerchantSessionGuard, RolesGuard)
  getArAging(@Req() req: MerchantAuthenticatedRequest): Promise<ArAgingResult> {
    return this.invoices.getArAging(req.merchant!.merchantId);
  }

  @Get('invoices/:id/integrity')
  @UseGuards(MerchantSessionGuard, RolesGuard)
  @Roles('owner', 'admin')
  verifyIntegrity(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<IntegrityResult> {
    return this.invoices.verifyPdfIntegrity(id);
  }

  @Patch('invoices/:id/mark-paid')
  @UseGuards(MerchantSessionGuard, RolesGuard)
  @Roles('owner', 'admin')
  markPaid(
    @Req() req: MerchantAuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(new ZodValidationPipe(MarkPaidSchema)) dto: MarkPaidInput,
  ): Promise<{ id: string; status: InvoiceStatus; amountPaid: string }> {
    const merchant = req.merchant!;
    return this.invoices.markAsPaid(
      id,
      merchant.merchantId,
      { amountPaid: dto.amount, paidAt: dto.paidAt, reference: dto.reference },
      merchant.userId,
    );
  }

  @Patch('invoices/:id/void')
  @UseGuards(MerchantSessionGuard, RolesGuard)
  @Roles('owner', 'admin')
  voidInvoice(
    @Req() req: MerchantAuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(new ZodValidationPipe(VoidInvoiceSchema)) dto: VoidInvoiceInput,
  ): Promise<{ id: string; status: InvoiceStatus }> {
    const merchant = req.merchant!;
    return this.invoices.voidInvoice(id, merchant.merchantId, dto.reason, merchant.userId);
  }

  @Post('invoices/:id/resend')
  @UseGuards(MerchantSessionGuard, RolesGuard)
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.OK)
  async resend(
    @Req() req: MerchantAuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<{ sent: boolean }> {
    // Per-invoice resend throttle (one send per window) backed by the cache Redis.
    const key = `invoice:resend:${id}`;
    const count = await this.cache.incr(key);
    if (count === 1) {
      await this.cache.expire(key, RESEND_WINDOW_SECONDS);
    }
    if (count > 1) {
      const ttl = await this.cache.ttl(key);
      const retryAfter = ttl > 0 ? ttl : RESEND_WINDOW_SECONDS;
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          code: 'RESEND_RATE_LIMITED',
          message: 'This invoice was re-sent recently; please wait before trying again',
          retryAfterSeconds: retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.invoices.resendInvoiceEmail(id, req.merchant!.merchantId);
  }

  // ── Buyer portal ────────────────────────────────────────────────────────

  @Get('buyer/invoices')
  @UseGuards(ClerkBuyerGuard)
  listBuyerInvoices(
    @Req() req: BuyerAuthenticatedRequest,
    @Query(new ZodValidationPipe(CursorPaginationSchema)) page: CursorPaginationInput,
    @Query('status') status?: string,
  ): Promise<PaginatedResponse<InvoiceSummary>> {
    const buyer = req.buyer!;
    return this.invoices.listInvoicesForBuyer(buyer.buyerId, buyer.merchantId, { ...page, status });
  }

  @Get('buyer/invoices/:id/download')
  @UseGuards(ClerkBuyerGuard)
  async downloadInvoice(
    @Req() req: BuyerAuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<{ url: string }> {
    const url = await this.invoices.getPresignedUrl(id, req.buyer!.buyerId);
    return { url };
  }
}
