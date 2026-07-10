import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import {
  ApproveBuyerSchema,
  BuyerRegisterApplicationSchema,
  CursorPaginationSchema,
  RejectBuyerSchema,
  UpdateBuyerSchema,
  type ApproveBuyerInput,
  type BuyerRegisterApplicationInput,
  type CursorPaginationInput,
  type PaginatedResponse,
  type RejectBuyerInput,
  type UpdateBuyerInput,
} from "@b2b/shared";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import {
  MerchantSessionGuard,
  type MerchantAuthenticatedRequest,
} from "../auth/guards/merchant-session.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import {
  ClerkAuthenticatedGuard,
  type BuyerIdentityRequest,
} from "../auth/guards/clerk-authenticated.guard";
import {
  ClerkBuyerGuard,
  type BuyerAuthenticatedRequest,
} from "../auth/guards/clerk-buyer.guard";
import { MerchantResolverService } from "../auth/merchant-resolver.service";
import {
  BuyersService,
  type ApplicationListItem,
  type ApplicationPii,
  type ApplicationResult,
  type ApplicationStatusView,
  type BuyerDetail,
  type BuyerMeView,
  type BuyerSummary,
  type MerchantContextView,
} from "./buyers.service";

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
 *     GET  /buyers/applications               list registration applications
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
  constructor(
    private readonly buyers: BuyersService,
    private readonly merchantResolver: MerchantResolverService,
  ) {}

  // ── Buyer: merchant context (white-label branding, pre-auth) ─────────────

  /**
   * Resolve the buyer's merchant tenant from the signed `X-Merchant-Context`
   * header. Used by the buyer portal shell (login/signup/apply headings) for
   * white-label branding before a Clerk session exists, so it needs no Clerk
   * guard — only a valid App-Proxy context token.
   */
  @Get("buyer/merchant-context")
  getMerchantContext(
    @Req() req: BuyerIdentityRequest,
  ): Promise<MerchantContextView> {
    return this.merchantResolver
      .resolveFromRequest(req)
      .then(({ merchantId }) => this.buyers.getMerchantContext(merchantId));
  }

  // ── Buyer: pre-approval application ──────────────────────────────────────

  @Post("buyer/apply")
  @UseGuards(ClerkAuthenticatedGuard)
  @HttpCode(HttpStatus.CREATED)
  async apply(
    @Req() req: BuyerIdentityRequest,
    @Body(new ZodValidationPipe(BuyerRegisterApplicationSchema))
    dto: BuyerRegisterApplicationInput,
  ): Promise<ApplicationResult> {
    const identity = req.buyerIdentity;
    if (!identity) {
      throw new UnauthorizedException({
        code: "MISSING_TOKEN",
        message: "Not authenticated",
      });
    }
    const { merchantId } = await this.merchantResolver.resolveFromRequest(req);
    const ipAddress = req.ip ?? "unknown";
    const userAgent =
      typeof req.headers["user-agent"] === "string"
        ? req.headers["user-agent"]
        : "unknown";
    return this.buyers.submitRegistrationApplication(
      merchantId,
      identity.clerkUserId,
      identity.email,
      dto,
      ipAddress,
      userAgent,
    );
  }

  /**
   * The buyer's application/relationship status for THIS merchant. Drives the
   * portal's pending / declined / approved routing. Read-only, no PII; the buyer
   * is Clerk-authenticated but not necessarily approved.
   */
  @Get("buyer/application-status")
  @UseGuards(ClerkAuthenticatedGuard)
  async applicationStatus(
    @Req() req: BuyerIdentityRequest,
  ): Promise<ApplicationStatusView> {
    const identity = req.buyerIdentity;
    if (!identity) {
      throw new UnauthorizedException({
        code: "MISSING_TOKEN",
        message: "Not authenticated",
      });
    }
    const { merchantId } = await this.merchantResolver.resolveFromRequest(req);
    return this.buyers.getApplicationStatusForBuyer(
      merchantId,
      identity.clerkUserId,
    );
  }

  // ── Buyer: own account snapshot (approved, ClerkBuyerGuard) ───────────────

  /**
   * The approved buyer's relationship snapshot for the resolved merchant tenant —
   * tier name, payment terms, credit limit/used/available, member-since, and
   * whether the merchant's plan enables BNPL. Powers the catalog welcome bar and
   * the Review-Order credit + BNPL sections. The tenant is the merchant resolved
   * by ClerkBuyerGuard from the App-Proxy cookie, never a client-supplied id.
   */
  @Get("buyer/me")
  @UseGuards(ClerkBuyerGuard)
  getBuyerMe(@Req() req: BuyerAuthenticatedRequest): Promise<BuyerMeView> {
    const buyer = req.buyer!;
    return this.buyers.getBuyerMe(buyer.buyerId, buyer.merchantId);
  }

  // ── Merchant: buyers list ────────────────────────────────────────────────

  @Get("buyers")
  @UseGuards(MerchantSessionGuard, RolesGuard)
  @Roles("owner", "admin")
  listBuyers(
    @Req() req: MerchantAuthenticatedRequest,
    @Query(new ZodValidationPipe(CursorPaginationSchema))
    page: CursorPaginationInput,
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

  @Get("buyers/applications")
  @UseGuards(MerchantSessionGuard, RolesGuard)
  @Roles("owner", "admin")
  listApplications(
    @Req() req: MerchantAuthenticatedRequest,
    @Query("status") status?: string,
  ): Promise<ApplicationListItem[]> {
    return this.buyers.listApplicationsForMerchant(
      req.merchant!.merchantId,
      status,
    );
  }

  @Post("buyers/applications/:id/approve")
  @UseGuards(MerchantSessionGuard, RolesGuard)
  @Roles("owner", "admin")
  @HttpCode(HttpStatus.NO_CONTENT)
  approve(
    @Req() req: MerchantAuthenticatedRequest,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body(new ZodValidationPipe(ApproveBuyerSchema)) dto: ApproveBuyerInput,
  ): Promise<void> {
    return this.buyers.approveApplication(
      id,
      req.merchant!.merchantId,
      dto,
      req.merchant!.userId,
    );
  }

  @Post("buyers/applications/:id/reject")
  @UseGuards(MerchantSessionGuard, RolesGuard)
  @Roles("owner", "admin")
  @HttpCode(HttpStatus.NO_CONTENT)
  reject(
    @Req() req: MerchantAuthenticatedRequest,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body(new ZodValidationPipe(RejectBuyerSchema)) dto: RejectBuyerInput,
  ): Promise<void> {
    return this.buyers.rejectApplication(
      id,
      req.merchant!.merchantId,
      dto,
      req.merchant!.userId,
    );
  }

  /**
   * Reveal an application's PII (taxId, phone) on demand. The list payload omits
   * these values; every reveal writes a `pii_revealed` audit row. POST (not GET)
   * so the audited access is never cached or logged in a URL.
   */
  @Post("buyers/applications/:id/reveal")
  @UseGuards(MerchantSessionGuard, RolesGuard)
  @Roles("owner", "admin")
  @HttpCode(HttpStatus.OK)
  revealApplicationPii(
    @Req() req: MerchantAuthenticatedRequest,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
  ): Promise<ApplicationPii> {
    return this.buyers.revealApplicationPii(
      id,
      req.merchant!.merchantId,
      req.merchant!.userId,
    );
  }

  // ── Merchant: suspension ─────────────────────────────────────────────────

  @Post("buyers/:buyerId/suspend")
  @UseGuards(MerchantSessionGuard, RolesGuard)
  @Roles("owner", "admin")
  @HttpCode(HttpStatus.NO_CONTENT)
  suspend(
    @Req() req: MerchantAuthenticatedRequest,
    @Param("buyerId", new ParseUUIDPipe({ version: "4" })) buyerId: string,
  ): Promise<void> {
    return this.buyers.suspendBuyer(
      buyerId,
      req.merchant!.merchantId,
      req.merchant!.userId,
    );
  }

  @Post("buyers/:buyerId/reinstate")
  @UseGuards(MerchantSessionGuard, RolesGuard)
  @Roles("owner", "admin")
  @HttpCode(HttpStatus.NO_CONTENT)
  reinstate(
    @Req() req: MerchantAuthenticatedRequest,
    @Param("buyerId", new ParseUUIDPipe({ version: "4" })) buyerId: string,
  ): Promise<void> {
    return this.buyers.reinstateBuyer(
      buyerId,
      req.merchant!.merchantId,
      req.merchant!.userId,
    );
  }

  // ── Merchant: buyer detail + approved-buyer edit ─────────────────────────

  @Get("buyers/:buyerId")
  @UseGuards(MerchantSessionGuard, RolesGuard)
  @Roles("owner", "admin")
  getBuyer(
    @Req() req: MerchantAuthenticatedRequest,
    @Param("buyerId", new ParseUUIDPipe({ version: "4" })) buyerId: string,
  ): Promise<BuyerDetail> {
    return this.buyers.getBuyerDetail(buyerId, req.merchant!.merchantId);
  }

  @Patch("buyers/:buyerId")
  @UseGuards(MerchantSessionGuard, RolesGuard)
  @Roles("owner", "admin")
  @HttpCode(HttpStatus.NO_CONTENT)
  updateBuyer(
    @Req() req: MerchantAuthenticatedRequest,
    @Param("buyerId", new ParseUUIDPipe({ version: "4" })) buyerId: string,
    @Body(new ZodValidationPipe(UpdateBuyerSchema)) dto: UpdateBuyerInput,
  ): Promise<void> {
    return this.buyers.updateBuyer(
      buyerId,
      req.merchant!.merchantId,
      dto,
      req.merchant!.userId,
    );
  }
}
