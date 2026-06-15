import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { createClerkClient, type ClerkClient } from '@clerk/backend';
import { Redis } from 'ioredis';
import * as Sentry from '@sentry/node';
import type {
  ApproveBuyerInput,
  BuyerRegisterApplicationInput,
  CursorPaginationInput,
  DecodedCursor,
  PaginatedResponse,
  PaymentTerms,
  RejectBuyerInput,
} from '@b2b/shared';
import { PrismaService, type PrismaTransaction } from '../prisma/prisma.service';
import { MerchantContextService } from '../prisma/merchant-context.service';
import { EmailService } from '../email/email.service';
import { AppConfigService } from '../config/app-config.service';
import { REDIS_CACHE } from '../redis/redis.module';

/** Banker's-rounding Decimal — consistent with the rest of the money pipeline. */
const Money = Decimal.clone({ rounding: Decimal.ROUND_HALF_EVEN, precision: 40 });
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const APPLY_RATE_LIMIT = 3;
const APPLY_RATE_WINDOW_SECONDS = 3600;
const PENDING_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Human-readable labels for payment terms (used in buyer-facing emails). */
const PAYMENT_TERMS_LABELS: Record<PaymentTerms, string> = {
  immediate: 'Due immediately',
  net15: 'Net 15 days',
  net30: 'Net 30 days',
  net60: 'Net 60 days',
  net90: 'Net 90 days',
};

/** Result of submitting a registration application. */
export interface ApplicationResult {
  applicationId: string;
  status: 'pending';
}

/** Filters accepted by {@link BuyersService.listBuyersForMerchant}. */
export interface BuyerFilters {
  approvalStatus?: string;
  pricingTierId?: string;
  searchQuery?: string;
}

/** Compact buyer row for the merchant admin buyers list. */
export interface BuyerSummary {
  buyerId: string;
  companyName: string;
  email: string;
  approvalStatus: string;
  pricingTierName: string | null;
  paymentTerms: PaymentTerms;
  creditLimit: string | null;
  orderCount: number;
  outstandingInvoiceTotal: string;
  lastOrderAt: string | null;
  createdAt: string;
}

/** GDPR subject-access export. PII is returned as stored (encrypted) — never decrypted here. */
export interface GdprExport {
  buyer: {
    companyName: string;
    email: string;
    businessType: string | null;
    createdAt: string;
  };
  relationship: {
    approvalStatus: string;
    pricingTierName: string | null;
    paymentTerms: PaymentTerms;
    creditLimit: string | null;
  };
  orders: Array<{
    shopifyOrderNumber: string | null;
    total: string;
    status: string;
    createdAt: string;
  }>;
  invoices: Array<{
    invoiceNumber: string;
    total: string;
    status: string;
    dueDate: string;
  }>;
  applications: Array<{
    status: string;
    createdAt: string;
    reviewedAt: string | null;
  }>;
}

/** Raw row shape for the FOR UPDATE application lock. */
interface LockedApplicationRow {
  id: string;
  merchantId: string;
  email: string;
  companyName: string;
  status: string;
}

/** Raw row shape for the buyers-list aggregation query. */
interface BuyerListRow {
  relationshipId: string;
  buyerId: string;
  companyName: string;
  email: string;
  approvalStatus: string;
  pricingTierName: string | null;
  paymentTerms: PaymentTerms;
  creditLimit: Prisma.Decimal | null;
  orderCount: bigint;
  outstandingInvoiceTotal: Prisma.Decimal;
  lastOrderAt: Date | null;
  createdAt: Date;
}

/**
 * Buyer domain: self-serve registration applications, the merchant approval
 * workflow, the merchant buyers list, suspension, and GDPR export/erasure.
 *
 * Buyers are UNIFIED cross-merchant (the `buyers` table carries no merchant_id
 * and no RLS); the per-merchant configuration — approval status, pricing tier,
 * payment terms, credit — lives on `merchant_buyer_relationships`, which IS
 * RLS-scoped. Tenant-scoped reads/writes run inside
 * {@link MerchantContextService.run}; transactional writes additionally
 * `SET LOCAL app.current_merchant_id` so the GUC and the write share one
 * connection under PgBouncer transaction pooling.
 */
@Injectable()
export class BuyersService {
  private readonly logger = new Logger(BuyersService.name);
  private readonly clerk: ClerkClient;

  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantContext: MerchantContextService,
    private readonly email: EmailService,
    private readonly config: AppConfigService,
    @Inject(REDIS_CACHE) private readonly cache: Redis,
  ) {
    this.clerk = createClerkClient({ secretKey: this.config.get('CLERK_SECRET_KEY') });
  }

  // ── Registration (pre-approval, ClerkAuthenticatedGuard) ────────────────

  /**
   * Submit a wholesale registration application. The buyer already authenticated
   * with Clerk (so `clerkUserId` is trusted); this links their Clerk identity to
   * the merchant via `buyer_registration_applications` and ensures a buyer record
   * exists. Idempotency-ish guards prevent spam (per-IP rate limit) and duplicate
   * submissions (existing approval / recent pending application).
   */
  async submitRegistrationApplication(
    merchantId: string,
    clerkUserId: string,
    dto: BuyerRegisterApplicationInput,
    ipAddress: string,
    userAgent: string,
  ): Promise<ApplicationResult> {
    this.assertUuid(merchantId);

    // 1. Per-IP rate limit: 3 applications / hour.
    await this.enforceApplyRateLimit(ipAddress);

    // 2. Sanitize (the Zod schema already trims + lowercases email; re-normalize
    //    defensively in case a caller bypasses the pipe).
    const email = dto.email.trim().toLowerCase();
    const companyName = dto.companyName.trim();

    // 3. Existing approved relationship for this Clerk user + merchant → 409.
    const existing = await this.merchantContext.run(merchantId, () =>
      this.prisma.merchantBuyerRelationship.findFirst({
        where: { merchantId, buyer: { clerkUserId }, approvalStatus: 'approved' },
        select: { id: true },
      }),
    );
    if (existing) {
      throw new ConflictException({
        code: 'ALREADY_APPROVED',
        message: 'You already have an approved account with this merchant',
      });
    }

    // 4. Pending application < 24h for this Clerk user + merchant → 429.
    const recentPending = await this.merchantContext.run(merchantId, () =>
      this.prisma.buyerRegistrationApplication.findFirst({
        where: {
          merchantId,
          status: 'pending',
          email,
          createdAt: { gte: new Date(Date.now() - PENDING_WINDOW_MS) },
        },
        select: { id: true },
      }),
    );
    if (recentPending) {
      throw new HttpException(
        { code: 'APPLICATION_PENDING', message: 'An application is already under review' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 5. Upsert the buyer record (cross-merchant, no RLS → system context). The
    //    Clerk webhook may have already created it; never touch credentials.
    const buyer = await this.merchantContext.runAsSystem(async () => {
      const found = await this.prisma.buyer.findUnique({
        where: { clerkUserId },
        select: { id: true },
      });
      if (found) {
        return this.prisma.buyer.update({
          where: { id: found.id },
          data: {
            companyName,
            ...(dto.businessType ? { businessType: dto.businessType.trim() } : {}),
          },
          select: { id: true },
        });
      }
      return this.prisma.buyer.create({
        data: {
          email,
          clerkUserId,
          companyName,
          passwordHash: '',
          ...(dto.businessType ? { businessType: dto.businessType.trim() } : {}),
        },
        select: { id: true },
      });
    });

    // 6. Insert the application.
    const application = await this.merchantContext.run(merchantId, () =>
      this.prisma.buyerRegistrationApplication.create({
        data: {
          merchantId,
          email,
          companyName,
          businessType: dto.businessType?.trim() ?? null,
          website: dto.website?.trim() ?? null,
          taxId: dto.taxId?.trim() ?? null,
          phone: dto.phone?.trim() ?? null,
          estimatedMonthlyOrder: dto.estimatedMonthlyOrder?.trim() ?? null,
          message: dto.message?.trim() ?? null,
          status: 'pending',
          ipAddress,
          userAgent,
        },
        select: { id: true },
      }),
    );

    const merchant = await this.loadMerchantName(merchantId);

    // 7. Applicant confirmation (non-throwing).
    await this.email.sendBuyerRegistrationConfirmation({
      to: email,
      applicantCompany: companyName,
      merchantName: merchant.name,
    });

    // 8. Merchant owner alert (non-throwing).
    const owner = await this.merchantContext.run(merchantId, () =>
      this.prisma.merchantUser.findFirst({
        where: { merchantId, role: 'owner' },
        select: { email: true },
      }),
    );
    if (owner) {
      await this.email.sendMerchantNewApplicationAlert({
        to: owner.email,
        applicantCompany: companyName,
        businessType: dto.businessType?.trim() ?? null,
        estimatedMonthlyOrder: dto.estimatedMonthlyOrder?.trim() ?? null,
        reviewUrl: this.applicationReviewUrl(application.id),
      });
    }

    // 9. Audit.
    await this.writeAudit(merchantId, {
      entityType: 'buyer_registration_application',
      entityId: application.id,
      action: 'created',
      actorType: 'buyer',
      actorId: buyer.id,
      ipAddress,
      userAgent,
    });

    return { applicationId: application.id, status: 'pending' };
  }

  // ── Approval workflow (merchant, MerchantSessionGuard) ───────────────────

  /**
   * Approve a pending application: create/refresh the approved relationship and
   * close the application. Runs inside a SERIALIZABLE transaction with the
   * application row locked FOR UPDATE so two reviewers cannot both act on it.
   * The approval email is sent AFTER commit (non-throwing).
   */
  async approveApplication(
    applicationId: string,
    merchantId: string,
    dto: ApproveBuyerInput,
    actorId: string,
  ): Promise<void> {
    this.assertUuid(applicationId);
    this.assertUuid(merchantId);
    this.assertUuid(actorId);
    if (dto.pricingTierId) this.assertUuid(dto.pricingTierId);

    const creditLimit = dto.creditLimit != null ? new Money(dto.creditLimit).toFixed(2) : null;

    const result = await this.prisma.$transaction(
      async (tx) => {
        await this.setTenant(tx, merchantId);
        const application = await this.lockApplication(tx, applicationId, merchantId);

        const buyer = await tx.buyer.findUnique({
          where: { email: application.email },
          select: { id: true, email: true, companyName: true },
        });
        if (!buyer) {
          throw new NotFoundException({
            code: 'BUYER_NOT_FOUND',
            message: 'No buyer record matches this application',
          });
        }

        await tx.merchantBuyerRelationship.upsert({
          where: { merchantId_buyerId: { merchantId, buyerId: buyer.id } },
          create: {
            merchantId,
            buyerId: buyer.id,
            approvalStatus: 'approved',
            pricingTierId: dto.pricingTierId ?? null,
            paymentTerms: dto.paymentTerms,
            creditLimit,
            notes: dto.notes ?? null,
            approvedBy: actorId,
            approvedAt: new Date(),
          },
          update: {
            approvalStatus: 'approved',
            pricingTierId: dto.pricingTierId ?? null,
            paymentTerms: dto.paymentTerms,
            creditLimit,
            notes: dto.notes ?? null,
            approvedBy: actorId,
            approvedAt: new Date(),
          },
        });

        await tx.buyerRegistrationApplication.update({
          where: { id: applicationId },
          data: { status: 'approved', reviewedBy: actorId, reviewedAt: new Date() },
        });

        await this.writeAuditTx(tx, merchantId, {
          entityType: 'buyer_registration_application',
          entityId: applicationId,
          action: 'approved',
          actorType: 'merchant_user',
          actorId,
          newValueJson: {
            pricingTierId: dto.pricingTierId ?? null,
            paymentTerms: dto.paymentTerms,
            creditLimit,
          },
        });

        return { buyerEmail: buyer.email, buyerCompany: buyer.companyName };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    const merchant = await this.loadMerchantName(merchantId);
    await this.email.sendBuyerApprovalEmail({
      to: result.buyerEmail,
      buyerCompany: result.buyerCompany,
      merchantName: merchant.name,
      paymentTermsLabel: PAYMENT_TERMS_LABELS[dto.paymentTerms],
      creditLimit,
      currency: 'USD',
      portalUrl: merchant.portalUrl,
    });
  }

  /**
   * Reject a pending application. Locks the row, records the reason, and emails
   * the applicant after commit (non-throwing). No relationship is created.
   */
  async rejectApplication(
    applicationId: string,
    merchantId: string,
    dto: RejectBuyerInput,
    actorId: string,
  ): Promise<void> {
    this.assertUuid(applicationId);
    this.assertUuid(merchantId);
    this.assertUuid(actorId);

    const result = await this.prisma.$transaction(
      async (tx) => {
        await this.setTenant(tx, merchantId);
        const application = await this.lockApplication(tx, applicationId, merchantId);

        await tx.buyerRegistrationApplication.update({
          where: { id: applicationId },
          data: {
            status: 'rejected',
            reviewedBy: actorId,
            rejectionReason: dto.rejectionReason,
            reviewedAt: new Date(),
          },
        });

        await this.writeAuditTx(tx, merchantId, {
          entityType: 'buyer_registration_application',
          entityId: applicationId,
          action: 'rejected',
          actorType: 'merchant_user',
          actorId,
          newValueJson: { rejectionReason: dto.rejectionReason },
        });

        return { email: application.email, companyName: application.companyName };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    const merchant = await this.loadMerchantName(merchantId);
    await this.email.sendBuyerRejectionEmail({
      to: result.email,
      buyerCompany: result.companyName,
      merchantName: merchant.name,
      merchantEmail: merchant.contactEmail,
      rejectionReason: dto.rejectionReason,
    });
  }

  // ── Buyers list (merchant, cursor paginated) ─────────────────────────────

  /**
   * The merchant's buyers with per-buyer aggregates (order count, outstanding AR,
   * last order date). A single query: scalar subqueries avoid the fan-out a
   * join-then-group would cause. Cursor-paginated on (relationship.createdAt, id).
   * `searchQuery` filters company_name via the pg_trgm GIN index (ILIKE).
   */
  async listBuyersForMerchant(
    merchantId: string,
    params: CursorPaginationInput & BuyerFilters,
  ): Promise<PaginatedResponse<BuyerSummary>> {
    this.assertUuid(merchantId);
    if (params.pricingTierId) this.assertUuid(params.pricingTierId);
    const cursor = this.decodeCursor(params.cursor);

    const conditions: Prisma.Sql[] = [Prisma.sql`r.merchant_id = ${merchantId}::uuid`];
    if (params.approvalStatus) {
      conditions.push(
        Prisma.sql`r.approval_status = ${params.approvalStatus}::"ApprovalStatus"`,
      );
    }
    if (params.pricingTierId) {
      conditions.push(Prisma.sql`r.pricing_tier_id = ${params.pricingTierId}::uuid`);
    }
    if (params.searchQuery && params.searchQuery.trim().length > 0) {
      const term = `%${params.searchQuery.trim()}%`;
      conditions.push(Prisma.sql`b.company_name ILIKE ${term}`);
    }
    if (cursor) {
      conditions.push(
        Prisma.sql`(r.created_at < ${new Date(cursor.createdAt)} OR (r.created_at = ${new Date(
          cursor.createdAt,
        )} AND r.id < ${cursor.id}::uuid))`,
      );
    }
    const where = Prisma.join(conditions, ' AND ');

    const rows = await this.merchantContext.run(merchantId, () =>
      this.prisma.$queryRaw<BuyerListRow[]>`
        SELECT
          r.id            AS "relationshipId",
          r.buyer_id      AS "buyerId",
          b.company_name  AS "companyName",
          b.email         AS "email",
          r.approval_status AS "approvalStatus",
          pt.name         AS "pricingTierName",
          r.payment_terms AS "paymentTerms",
          r.credit_limit  AS "creditLimit",
          r.created_at    AS "createdAt",
          (SELECT COUNT(*) FROM orders o
             WHERE o.buyer_id = r.buyer_id AND o.merchant_id = r.merchant_id) AS "orderCount",
          (SELECT COALESCE(SUM(i.total - i.amount_paid), 0) FROM invoices i
             WHERE i.buyer_id = r.buyer_id AND i.merchant_id = r.merchant_id
               AND i.status NOT IN ('paid', 'void')) AS "outstandingInvoiceTotal",
          (SELECT MAX(o.created_at) FROM orders o
             WHERE o.buyer_id = r.buyer_id AND o.merchant_id = r.merchant_id) AS "lastOrderAt"
        FROM merchant_buyer_relationships r
        JOIN buyers b ON b.id = r.buyer_id
        LEFT JOIN pricing_tiers pt ON pt.id = r.pricing_tier_id
        WHERE ${where}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT ${params.limit + 1}`,
    );

    const hasNextPage = rows.length > params.limit;
    const page = hasNextPage ? rows.slice(0, params.limit) : rows;
    const last = page[page.length - 1];
    const endCursor =
      hasNextPage && last
        ? this.encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.relationshipId })
        : null;

    return {
      data: page.map((row) => ({
        buyerId: row.buyerId,
        companyName: row.companyName,
        email: row.email,
        approvalStatus: row.approvalStatus,
        pricingTierName: row.pricingTierName,
        paymentTerms: row.paymentTerms,
        creditLimit: row.creditLimit ? new Money(row.creditLimit.toString()).toFixed(2) : null,
        orderCount: Number(row.orderCount),
        outstandingInvoiceTotal: new Money(row.outstandingInvoiceTotal.toString()).toFixed(2),
        lastOrderAt: row.lastOrderAt ? row.lastOrderAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
      })),
      pageInfo: { hasNextPage, endCursor },
    };
  }

  // ── Suspension (merchant) ────────────────────────────────────────────────

  /**
   * Suspend a buyer's access for this merchant. The Clerk session stays valid;
   * ClerkBuyerGuard blocks portal access on the `suspended` approval status.
   */
  async suspendBuyer(buyerId: string, merchantId: string, actorId: string): Promise<void> {
    this.assertUuid(buyerId);
    this.assertUuid(merchantId);
    this.assertUuid(actorId);

    const updated = await this.merchantContext.run(merchantId, () =>
      this.prisma.merchantBuyerRelationship.updateMany({
        where: { merchantId, buyerId },
        data: { approvalStatus: 'suspended' },
      }),
    );
    if (updated.count === 0) {
      throw new NotFoundException({
        code: 'RELATIONSHIP_NOT_FOUND',
        message: 'No relationship with this buyer',
      });
    }

    await this.writeAudit(merchantId, {
      entityType: 'merchant_buyer_relationship',
      entityId: buyerId,
      action: 'suspended',
      actorType: 'merchant_user',
      actorId,
    });
  }

  // ── GDPR (merchant) ──────────────────────────────────────────────────────

  /**
   * Subject-access export for a buyer scoped to this merchant. PII (taxId, phone)
   * is intentionally NOT included/decrypted; financial records are summarized.
   */
  async getBuyerGdprExport(buyerId: string, merchantId: string): Promise<GdprExport> {
    this.assertUuid(buyerId);
    this.assertUuid(merchantId);

    const buyer = await this.merchantContext.runAsSystem(() =>
      this.prisma.buyer.findUnique({
        where: { id: buyerId },
        select: { companyName: true, email: true, businessType: true, createdAt: true },
      }),
    );
    if (!buyer) {
      throw new NotFoundException({ code: 'BUYER_NOT_FOUND', message: 'Buyer not found' });
    }

    const data = await this.merchantContext.run(merchantId, async () => {
      const relationship = await this.prisma.merchantBuyerRelationship.findFirst({
        where: { merchantId, buyerId },
        select: {
          approvalStatus: true,
          paymentTerms: true,
          creditLimit: true,
          pricingTier: { select: { name: true } },
        },
      });
      if (!relationship) {
        throw new NotFoundException({
          code: 'RELATIONSHIP_NOT_FOUND',
          message: 'No relationship with this buyer',
        });
      }
      const orders = await this.prisma.order.findMany({
        where: { merchantId, buyerId },
        orderBy: { createdAt: 'desc' },
        select: { shopifyOrderNumber: true, total: true, status: true, createdAt: true },
      });
      const invoices = await this.prisma.invoice.findMany({
        where: { merchantId, buyerId },
        orderBy: { createdAt: 'desc' },
        select: { invoiceNumber: true, total: true, status: true, dueDate: true },
      });
      const applications = await this.prisma.buyerRegistrationApplication.findMany({
        where: { merchantId, email: buyer.email },
        orderBy: { createdAt: 'desc' },
        select: { status: true, createdAt: true, reviewedAt: true },
      });
      return { relationship, orders, invoices, applications };
    });

    return {
      buyer: {
        companyName: buyer.companyName,
        email: buyer.email,
        businessType: buyer.businessType,
        createdAt: buyer.createdAt.toISOString(),
      },
      relationship: {
        approvalStatus: data.relationship.approvalStatus,
        pricingTierName: data.relationship.pricingTier?.name ?? null,
        paymentTerms: data.relationship.paymentTerms,
        creditLimit: data.relationship.creditLimit
          ? new Money(data.relationship.creditLimit.toString()).toFixed(2)
          : null,
      },
      orders: data.orders.map((o) => ({
        shopifyOrderNumber: o.shopifyOrderNumber,
        total: o.total.toFixed(2),
        status: o.status,
        createdAt: o.createdAt.toISOString(),
      })),
      invoices: data.invoices.map((i) => ({
        invoiceNumber: i.invoiceNumber,
        total: i.total.toFixed(2),
        status: i.status,
        dueDate: i.dueDate.toISOString(),
      })),
      applications: data.applications.map((a) => ({
        status: a.status,
        createdAt: a.createdAt.toISOString(),
        reviewedAt: a.reviewedAt ? a.reviewedAt.toISOString() : null,
      })),
    };
  }

  /**
   * GDPR right-to-erasure. Refuses while unpaid invoices remain (financial
   * obligation), anonymizes the buyer record, unlinks + deletes the Clerk account
   * (best-effort), and retains orders/invoices for the 7-year retention window.
   */
  async eraseBuyer(buyerId: string, merchantId: string, actorId: string): Promise<void> {
    this.assertUuid(buyerId);
    this.assertUuid(merchantId);
    this.assertUuid(actorId);

    // 1. No outstanding unpaid invoices.
    const outstanding = await this.merchantContext.run(merchantId, () =>
      this.prisma.invoice.count({
        where: { merchantId, buyerId, status: { notIn: ['paid', 'void'] } },
      }),
    );
    if (outstanding > 0) {
      throw new ConflictException({
        code: 'OUTSTANDING_INVOICES',
        message: 'Cannot erase a buyer with outstanding invoices',
        count: outstanding,
      });
    }

    // 2. Load the Clerk linkage before we null it out.
    const buyer = await this.merchantContext.runAsSystem(() =>
      this.prisma.buyer.findUnique({ where: { id: buyerId }, select: { clerkUserId: true } }),
    );
    if (!buyer) {
      throw new NotFoundException({ code: 'BUYER_NOT_FOUND', message: 'Buyer not found' });
    }

    // 3. Anonymize the buyer record (authoritative erasure record).
    await this.merchantContext.runAsSystem(() =>
      this.prisma.buyer.update({
        where: { id: buyerId },
        data: {
          anonymizedAt: new Date(),
          email: `erased+${randomUUID()}@redacted.invalid`,
          companyName: 'ERASED',
          taxId: null,
          phone: null,
          addressJson: Prisma.DbNull,
          clerkUserId: null,
          passwordHash: '',
        },
      }),
    );

    // 4. Delete the Clerk account — best effort; DB anonymization is authoritative.
    if (buyer.clerkUserId) {
      try {
        await this.clerk.users.deleteUser(buyer.clerkUserId);
      } catch (error) {
        Sentry.captureException(error, {
          level: 'error',
          tags: { component: 'buyers', stage: 'clerk_delete' },
          extra: { buyerId, clerkUserId: buyer.clerkUserId },
        });
        this.logger.error(
          `Clerk deletion failed for buyer ${buyerId}; DB anonymization stands: ${(error as Error).message}`,
        );
      }
    }

    // 5/6. Orders + invoices retained (7-year obligation). Audit the erasure.
    await this.writeAudit(merchantId, {
      entityType: 'buyer',
      entityId: buyerId,
      action: 'gdpr_erased',
      actorType: 'merchant_user',
      actorId,
    });
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private async enforceApplyRateLimit(ipAddress: string): Promise<void> {
    const key = `apply:rate:${ipAddress}`;
    const count = await this.cache.incr(key);
    if (count === 1) {
      await this.cache.expire(key, APPLY_RATE_WINDOW_SECONDS);
    }
    if (count > APPLY_RATE_LIMIT) {
      throw new HttpException(
        { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many applications; try again later' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async lockApplication(
    tx: PrismaTransaction,
    applicationId: string,
    merchantId: string,
  ): Promise<LockedApplicationRow> {
    const rows = await tx.$queryRaw<LockedApplicationRow[]>`
      SELECT id,
             merchant_id  AS "merchantId",
             email,
             company_name AS "companyName",
             status::text AS "status"
      FROM buyer_registration_applications
      WHERE id = ${applicationId}::uuid
      FOR UPDATE`;
    const application = rows[0];
    if (!application || application.merchantId !== merchantId) {
      throw new NotFoundException({
        code: 'APPLICATION_NOT_FOUND',
        message: 'Application not found',
      });
    }
    if (application.status !== 'pending') {
      throw new ConflictException({
        code: 'APPLICATION_NOT_PENDING',
        message: `Application is already ${application.status}`,
      });
    }
    return application;
  }

  private async loadMerchantName(
    merchantId: string,
  ): Promise<{ name: string; contactEmail: string; portalUrl: string }> {
    const merchant = await this.merchantContext.runAsSystem(() =>
      this.prisma.merchant.findUnique({
        where: { id: merchantId },
        select: { shopifyDomain: true, users: { where: { role: 'owner' }, select: { email: true }, take: 1 } },
      }),
    );
    const domain = merchant?.shopifyDomain ?? 'your supplier';
    return {
      name: domain,
      contactEmail: merchant?.users[0]?.email ?? this.config.get('RESEND_FROM_ADDRESS'),
      portalUrl: `https://${domain}`,
    };
  }

  private applicationReviewUrl(applicationId: string): string {
    return `https://${this.config.get('PLATFORM_DOMAIN')}/merchant/buyers/applications/${applicationId}`;
  }

  private async writeAudit(
    merchantId: string,
    entry: {
      entityType: string;
      entityId: string;
      action: string;
      actorType: 'buyer' | 'merchant_user' | 'system';
      actorId: string;
      newValueJson?: Prisma.InputJsonValue;
      ipAddress?: string;
      userAgent?: string;
    },
  ): Promise<void> {
    try {
      await this.merchantContext.run(merchantId, () =>
        this.prisma.auditLog.create({
          data: {
            merchantId,
            entityType: entry.entityType,
            entityId: entry.entityId,
            action: entry.action,
            actorType: entry.actorType,
            actorId: entry.actorId,
            ...(entry.newValueJson !== undefined ? { newValueJson: entry.newValueJson } : {}),
            ...(entry.ipAddress ? { ipAddress: entry.ipAddress } : {}),
            ...(entry.userAgent ? { userAgent: entry.userAgent } : {}),
          },
        }),
      );
    } catch (error) {
      this.logger.error(`Failed to write audit log: ${(error as Error).message}`);
    }
  }

  private async writeAuditTx(
    tx: PrismaTransaction,
    merchantId: string,
    entry: {
      entityType: string;
      entityId: string;
      action: string;
      actorType: 'buyer' | 'merchant_user' | 'system';
      actorId: string;
      newValueJson?: Prisma.InputJsonValue;
    },
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        merchantId,
        entityType: entry.entityType,
        entityId: entry.entityId,
        action: entry.action,
        actorType: entry.actorType,
        actorId: entry.actorId,
        ...(entry.newValueJson !== undefined ? { newValueJson: entry.newValueJson } : {}),
      },
    });
  }

  private async setTenant(tx: PrismaTransaction, merchantId: string): Promise<void> {
    this.assertUuid(merchantId);
    await tx.$executeRawUnsafe(`SET LOCAL app.current_merchant_id = '${merchantId}'`);
  }

  private encodeCursor(cursor: DecodedCursor): string {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64');
  }

  private decodeCursor(raw: string | undefined): DecodedCursor | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as Partial<DecodedCursor>;
      if (typeof parsed.createdAt === 'string' && typeof parsed.id === 'string') {
        return { createdAt: parsed.createdAt, id: parsed.id };
      }
    } catch {
      // fall through to the invalid-cursor error
    }
    throw new BadRequestException({ code: 'INVALID_CURSOR', message: 'Malformed pagination cursor' });
  }

  private assertUuid(value: string): void {
    if (!UUID_RE.test(value)) {
      throw new BadRequestException({ code: 'INVALID_ID', message: `Malformed id: ${value}` });
    }
  }
}
