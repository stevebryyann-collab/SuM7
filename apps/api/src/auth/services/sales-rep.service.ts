import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { PaymentTerms } from '@b2b/shared';
import { generateSecureToken } from '@b2b/shared';
import type { InvoiceStatus, OrderStatus, OrderSyncStatus } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../prisma/prisma.service';
import { MerchantContextService } from '../../prisma/merchant-context.service';

/** A rep's view of a single approved buyer (rep portal buyer list row). */
export interface RepBuyerListItem {
  buyerId: string;
  companyName: string;
  email: string;
  pricingTierName: string | null;
  paymentTerms: PaymentTerms;
  lastOrderAt: string | null;
  totalOrderCount: number;
  outstandingBalance: string;
  creditUsed: string;
  creditLimit: string | null;
}

/** One order row in a rep's per-buyer order history. */
export interface RepBuyerOrderItem {
  id: string;
  shopifyOrderNumber: string | null;
  createdAt: string;
  itemCount: number;
  total: string;
  currency: string;
  status: OrderStatus;
  syncStatus: OrderSyncStatus;
  invoiceStatus: InvoiceStatus | null;
  invoiceNumber: string | null;
}

/** Result of starting an impersonation session. */
export interface SalesRepSessionResult {
  sessionToken: string;
  expiresAt: string;
  buyerInfo: {
    buyerId: string;
    companyName: string;
    email: string;
    pricingTierId: string | null;
  };
}

/** The validated principal a rep-session token resolves to (used by the guard). */
export interface SalesRepSessionData {
  sessionId: string;
  repId: string;
  merchantId: string;
  buyerId: string;
}

const SESSION_TTL_HOURS = 4;

/**
 * Sales-rep impersonation. A merchant staff member with the `sales_rep` role
 * (or an admin/owner) opens a short-lived session against an approved buyer and
 * then places an order through the normal buyer portal — the session token is
 * presented in the `X-Sales-Rep-Session` header and resolved by
 * {@link SalesRepSessionGuard}, which populates the BUYER principal so every
 * buyer route behaves identically to a real buyer login.
 *
 * All merchant-facing methods run inside the request's tenant context (opened by
 * the TenantContextInterceptor) and additionally scope every query by
 * `merchantId` — defence in depth alongside the RLS policy on
 * `sales_rep_sessions`. {@link validateRepSession} is the only cross-cutting
 * lookup and runs as the SYSTEM (it must find the session before the tenant is
 * known).
 */
@Injectable()
export class SalesRepService {
  private readonly logger = new Logger(SalesRepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantContext: MerchantContextService,
  ) {}

  /**
   * Open a 4-hour impersonation session. Verifies the actor is a `sales_rep`,
   * `admin` or `owner` on this merchant and that the target buyer is approved.
   */
  async startImpersonation(
    repUserId: string,
    merchantId: string,
    buyerId: string,
  ): Promise<SalesRepSessionResult> {
    const rep = await this.prisma.merchantUser.findFirst({
      where: { id: repUserId, merchantId, isActive: true },
      select: { role: true },
    });
    if (!rep || !['sales_rep', 'admin', 'owner'].includes(rep.role)) {
      throw new ForbiddenException({
        code: 'NOT_A_SALES_REP',
        message: 'This account cannot place orders on behalf of buyers',
      });
    }

    const relationship = await this.prisma.merchantBuyerRelationship.findFirst({
      where: { merchantId, buyerId, approvalStatus: 'approved' },
      select: {
        pricingTierId: true,
        buyer: { select: { companyName: true, email: true, anonymizedAt: true } },
      },
    });
    if (!relationship || relationship.buyer.anonymizedAt) {
      throw new NotFoundException({
        code: 'BUYER_NOT_APPROVED',
        message: 'No approved buyer found for this merchant',
      });
    }

    const sessionToken = generateSecureToken(32);
    const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);

    await this.prisma.salesRepSession.create({
      data: { repId: repUserId, merchantId, buyerId, sessionToken, expiresAt },
      select: { id: true },
    });

    this.logger.log(
      `Rep ${repUserId} started impersonation of buyer ${buyerId} (merchant ${merchantId})`,
    );

    return {
      sessionToken,
      expiresAt: expiresAt.toISOString(),
      buyerInfo: {
        buyerId,
        companyName: relationship.buyer.companyName,
        email: relationship.buyer.email,
        pricingTierId: relationship.pricingTierId,
      },
    };
  }

  /** End an impersonation session early (idempotent — only affects open rows). */
  async endImpersonation(sessionToken: string, merchantId: string): Promise<void> {
    await this.prisma.salesRepSession.updateMany({
      where: { sessionToken, merchantId, endedAt: null },
      data: { endedAt: new Date() },
    });
    this.logger.log(`Rep session ended (merchant ${merchantId})`);
  }

  /**
   * Resolve an active session token to its principal, or null when missing,
   * already ended, or expired. Runs as the SYSTEM: the tenant is unknown until
   * the session is found, so this single auth-layer read bypasses RLS.
   */
  async validateRepSession(sessionToken: string): Promise<SalesRepSessionData | null> {
    return this.merchantContext.runAsSystem(async () => {
      const session = await this.prisma.salesRepSession.findFirst({
        where: { sessionToken, endedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true, repId: true, merchantId: true, buyerId: true },
      });
      if (!session) return null;
      return {
        sessionId: session.id,
        repId: session.repId,
        merchantId: session.merchantId,
        buyerId: session.buyerId,
      };
    });
  }

  /**
   * Cursor-paginated list of this merchant's APPROVED buyers, enriched with the
   * per-buyer order count, last-order date and outstanding AR balance. Optional
   * case-insensitive `search` filters on company name. Ordered newest-relationship
   * first with the relationship id as the opaque cursor (mirrors discount-codes).
   */
  async listBuyers(
    merchantId: string,
    cursor?: string,
    limit = 25,
    search?: string,
  ): Promise<{ buyers: RepBuyerListItem[]; nextCursor: string | null }> {
    const term = search?.trim();
    const relationships = await this.prisma.merchantBuyerRelationship.findMany({
      where: {
        merchantId,
        approvalStatus: 'approved',
        ...(term ? { buyer: { companyName: { contains: term, mode: 'insensitive' } } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      select: {
        id: true,
        buyerId: true,
        paymentTerms: true,
        creditUsed: true,
        creditLimit: true,
        pricingTier: { select: { name: true } },
        buyer: { select: { companyName: true, email: true } },
      },
    });

    const hasMore = relationships.length > limit;
    const page = hasMore ? relationships.slice(0, limit) : relationships;
    const nextCursor = hasMore ? page[page.length - 1]!.id : null;
    const buyerIds = page.map((r) => r.buyerId);

    if (buyerIds.length === 0) {
      return { buyers: [], nextCursor: null };
    }

    // Per-buyer order count + most recent order date (one grouped query).
    const orderAgg = await this.prisma.order.groupBy({
      by: ['buyerId'],
      where: { merchantId, buyerId: { in: buyerIds } },
      _count: { _all: true },
      _max: { createdAt: true },
    });
    const orderByBuyer = new Map(orderAgg.map((row) => [row.buyerId, row]));

    // Outstanding AR = Σ(total − amountPaid) over not-paid / not-void invoices.
    const openInvoices = await this.prisma.invoice.findMany({
      where: {
        merchantId,
        buyerId: { in: buyerIds },
        status: { notIn: ['paid', 'void'] },
      },
      select: { buyerId: true, total: true, amountPaid: true },
    });
    const outstandingByBuyer = new Map<string, Decimal>();
    for (const inv of openInvoices) {
      const due = new Decimal(inv.total.toString()).minus(inv.amountPaid.toString());
      const prev = outstandingByBuyer.get(inv.buyerId) ?? new Decimal(0);
      outstandingByBuyer.set(inv.buyerId, prev.plus(Decimal.max(due, 0)));
    }

    const buyers: RepBuyerListItem[] = page.map((r) => {
      const agg = orderByBuyer.get(r.buyerId);
      return {
        buyerId: r.buyerId,
        companyName: r.buyer.companyName,
        email: r.buyer.email,
        pricingTierName: r.pricingTier?.name ?? null,
        paymentTerms: r.paymentTerms,
        lastOrderAt: agg?._max.createdAt ? agg._max.createdAt.toISOString() : null,
        totalOrderCount: agg?._count._all ?? 0,
        outstandingBalance: (outstandingByBuyer.get(r.buyerId) ?? new Decimal(0)).toFixed(2),
        creditUsed: new Decimal(r.creditUsed.toString()).toFixed(2),
        creditLimit: r.creditLimit !== null ? new Decimal(r.creditLimit.toString()).toFixed(2) : null,
      };
    });

    return { buyers, nextCursor };
  }

  /**
   * Cursor-paginated order history for one buyer under this merchant, each row
   * carrying its invoice status. Verifies the buyer is related to the merchant
   * before returning anything (avoids leaking cross-merchant order ids).
   */
  async listBuyerOrders(
    merchantId: string,
    buyerId: string,
    cursor?: string,
    limit = 25,
  ): Promise<{ orders: RepBuyerOrderItem[]; nextCursor: string | null }> {
    const relationship = await this.prisma.merchantBuyerRelationship.findFirst({
      where: { merchantId, buyerId },
      select: { id: true },
    });
    if (!relationship) {
      throw new NotFoundException({
        code: 'BUYER_NOT_FOUND',
        message: 'No buyer relationship found for this merchant',
      });
    }

    const orders = await this.prisma.order.findMany({
      where: { merchantId, buyerId },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      select: {
        id: true,
        shopifyOrderNumber: true,
        createdAt: true,
        total: true,
        currency: true,
        status: true,
        syncStatus: true,
        _count: { select: { lineItems: true } },
        invoice: { select: { status: true, invoiceNumber: true } },
      },
    });

    const hasMore = orders.length > limit;
    const page = hasMore ? orders.slice(0, limit) : orders;
    const nextCursor = hasMore ? page[page.length - 1]!.id : null;

    return {
      orders: page.map((o) => ({
        id: o.id,
        shopifyOrderNumber: o.shopifyOrderNumber,
        createdAt: o.createdAt.toISOString(),
        itemCount: o._count.lineItems,
        total: new Decimal(o.total.toString()).toFixed(2),
        currency: o.currency,
        status: o.status,
        syncStatus: o.syncStatus,
        invoiceStatus: o.invoice?.status ?? null,
        invoiceNumber: o.invoice?.invoiceNumber ?? null,
      })),
      nextCursor,
    };
  }
}
