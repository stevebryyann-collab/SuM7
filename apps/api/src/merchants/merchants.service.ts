import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  type MerchantRole,
  type TeamMemberRole,
  type UpdateMerchantSettingsInput,
  type UpsertMerchantInput,
} from '@b2b/shared';
import { PrismaService, type PrismaTransaction } from '../prisma/prisma.service';
import { MerchantContextService } from '../prisma/merchant-context.service';
import { EncryptionService } from '../crypto/encryption.service';
import { AppConfigService } from '../config/app-config.service';

/** Result returned to the internal merchant-provisioning caller. */
export interface MerchantUpsertResult {
  merchantId: string;
  merchantUserId: string;
  shopifyDomain: string;
  role: MerchantRole;
  email: string;
}

/** Merchant settings payload (`GET/PUT /api/v1/settings`). */
export interface MerchantSettings {
  storeName: string;
  shopifyDomain: string;
  platformDomain: string;
  /** White-label buyer-portal URL on the merchant's storefront. */
  applicationLink: string;
  invoicePrefix: string;
  paymentInstructions: string | null;
  notifications: {
    newApplication: boolean;
    invoiceOverdue: boolean;
    paymentReceived: boolean;
  };
}

/** One row of the team table (`GET /api/v1/team`). */
export interface TeamMember {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: MerchantRole;
  lastLoginAt: string | null;
  isActive: boolean;
  createdAt: string;
}

@Injectable()
export class MerchantsService {
  private readonly logger = new Logger(MerchantsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantContext: MerchantContextService,
    private readonly encryption: EncryptionService,
    private readonly config: AppConfigService,
  ) {}

  // ── Settings (Stage 4) ─────────────────────────────────────────────────

  /** The merchant's general + invoice + notification settings. */
  async getSettings(merchantId: string): Promise<MerchantSettings> {
    const merchant = await this.merchantContext.run(merchantId, () =>
      this.prisma.merchant.findUniqueOrThrow({
        where: { id: merchantId },
        select: {
          shopifyDomain: true,
          invoicePrefix: true,
          paymentInstructions: true,
          notifyNewApplication: true,
          notifyInvoiceOverdue: true,
          notifyPaymentReceived: true,
        },
      }),
    );
    return this.toSettings(merchant);
  }

  /** Update invoice + notification settings. Returns the fresh settings. Audited. */
  async updateSettings(
    merchantId: string,
    dto: UpdateMerchantSettingsInput,
    actorId: string,
  ): Promise<MerchantSettings> {
    const merchant = await this.merchantContext.run(merchantId, () =>
      this.prisma.merchant.update({
        where: { id: merchantId },
        data: {
          invoicePrefix: dto.invoicePrefix,
          paymentInstructions: dto.paymentInstructions,
          notifyNewApplication: dto.notifications.newApplication,
          notifyInvoiceOverdue: dto.notifications.invoiceOverdue,
          notifyPaymentReceived: dto.notifications.paymentReceived,
        },
        select: {
          shopifyDomain: true,
          invoicePrefix: true,
          paymentInstructions: true,
          notifyNewApplication: true,
          notifyInvoiceOverdue: true,
          notifyPaymentReceived: true,
        },
      }),
    );
    await this.writeAudit(merchantId, merchantId, 'settings_updated', actorId, {
      invoicePrefix: dto.invoicePrefix,
    });
    return this.toSettings(merchant);
  }

  private toSettings(merchant: {
    shopifyDomain: string;
    invoicePrefix: string;
    paymentInstructions: string | null;
    notifyNewApplication: boolean;
    notifyInvoiceOverdue: boolean;
    notifyPaymentReceived: boolean;
  }): MerchantSettings {
    const platformDomain = this.config.get('PLATFORM_DOMAIN');
    return {
      storeName: merchant.shopifyDomain.split('.')[0] ?? merchant.shopifyDomain,
      shopifyDomain: merchant.shopifyDomain,
      platformDomain,
      applicationLink: `https://${merchant.shopifyDomain}/apps/wholesale`,
      invoicePrefix: merchant.invoicePrefix,
      paymentInstructions: merchant.paymentInstructions,
      notifications: {
        newApplication: merchant.notifyNewApplication,
        invoiceOverdue: merchant.notifyInvoiceOverdue,
        paymentReceived: merchant.notifyPaymentReceived,
      },
    };
  }

  // ── Team (Stage 4 — owner only) ────────────────────────────────────────

  /** List the merchant's staff users, owner first then by creation. */
  async listTeam(merchantId: string): Promise<TeamMember[]> {
    const users = await this.merchantContext.run(merchantId, () =>
      this.prisma.merchantUser.findMany({
        where: { merchantId },
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          lastLoginAt: true,
          isActive: true,
          createdAt: true,
        },
      }),
    );
    return users.map((user) => ({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role as MerchantRole,
      lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
      isActive: user.isActive,
      createdAt: user.createdAt.toISOString(),
    }));
  }

  /** Change a non-owner member's role. The owner role cannot be assigned or removed. */
  async changeTeamRole(
    merchantId: string,
    userId: string,
    role: TeamMemberRole,
    actorId: string,
  ): Promise<TeamMember> {
    const target = await this.findTeamMember(merchantId, userId);
    if (target.role === 'owner') {
      throw new ForbiddenException({
        code: 'CANNOT_MODIFY_OWNER',
        message: 'The owner role cannot be changed',
      });
    }
    const updated = await this.merchantContext.run(merchantId, () =>
      this.prisma.merchantUser.update({
        where: { id: userId },
        data: { role },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          lastLoginAt: true,
          isActive: true,
          createdAt: true,
        },
      }),
    );
    await this.writeAudit(merchantId, userId, 'team_role_changed', actorId, { role });
    return {
      id: updated.id,
      email: updated.email,
      firstName: updated.firstName,
      lastName: updated.lastName,
      role: updated.role as MerchantRole,
      lastLoginAt: updated.lastLoginAt ? updated.lastLoginAt.toISOString() : null,
      isActive: updated.isActive,
      createdAt: updated.createdAt.toISOString(),
    };
  }

  /** Remove a team member. The owner and the acting user cannot be removed. */
  async removeTeamMember(merchantId: string, userId: string, actorId: string): Promise<void> {
    const target = await this.findTeamMember(merchantId, userId);
    if (target.role === 'owner') {
      throw new ForbiddenException({
        code: 'CANNOT_REMOVE_OWNER',
        message: 'The owner cannot be removed',
      });
    }
    if (userId === actorId) {
      throw new ForbiddenException({
        code: 'CANNOT_REMOVE_SELF',
        message: 'You cannot remove yourself',
      });
    }
    await this.merchantContext.run(merchantId, () =>
      this.prisma.merchantUser.delete({ where: { id: userId } }),
    );
    await this.writeAudit(merchantId, userId, 'team_member_removed', actorId, {
      email: target.email,
    });
  }

  private async findTeamMember(
    merchantId: string,
    userId: string,
  ): Promise<{ id: string; email: string; role: MerchantRole }> {
    const user = await this.merchantContext.run(merchantId, () =>
      this.prisma.merchantUser.findFirst({
        where: { id: userId, merchantId },
        select: { id: true, email: true, role: true },
      }),
    );
    if (!user) {
      throw new NotFoundException({ code: 'TEAM_MEMBER_NOT_FOUND', message: 'Team member not found' });
    }
    return { id: user.id, email: user.email, role: user.role as MerchantRole };
  }

  /** Best-effort audit write for settings/team mutations (never throws). */
  private async writeAudit(
    merchantId: string,
    entityId: string,
    action: string,
    actorId: string,
    newValue: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.merchantContext.run(merchantId, () =>
        this.prisma.auditLog.create({
          data: {
            merchantId,
            entityType: 'merchant',
            entityId,
            action,
            actorType: 'merchant_user',
            actorId,
            newValueJson: newValue as Record<string, string>,
          },
        }),
      );
    } catch (error) {
      this.logger.error(`Failed to write merchant audit log: ${(error as Error).message}`);
    }
  }

  /**
   * Idempotently provision a merchant + its owner user from a Shopify OAuth
   * sign-in (called by the web NextAuth callback via /internal/merchants/upsert).
   *
   * Runs as the SYSTEM (bypass RLS): on first sign-in the merchant row does not
   * exist yet, so there is no tenant scope to attach to. The whole operation is
   * one interactive transaction so the `SET LOCAL` bypass and the writes share a
   * single physical connection (correct under PgBouncer transaction pooling).
   * The Shopify access token is encrypted at rest (AES-256-GCM, versioned).
   */
  async upsert(input: UpsertMerchantInput): Promise<MerchantUpsertResult> {
    const ciphertext = this.encryption.encrypt(input.shopifyAccessToken);
    const keyVersion = this.encryption.versionOf(ciphertext);

    const result = await this.merchantContext.runAsSystem(() =>
      this.prisma.withTenantTransaction(async (tx) => {
        const merchant = await tx.merchant.upsert({
          where: { shopifyDomain: input.shopifyDomain },
          // Refresh the stored token: Shopify may re-issue it on re-auth.
          update: {
            shopifyAccessToken: ciphertext,
            shopifyAccessTokenKeyVersion: keyVersion,
          },
          create: {
            shopifyDomain: input.shopifyDomain,
            shopifyAccessToken: ciphertext,
            shopifyAccessTokenKeyVersion: keyVersion,
          },
          select: { id: true, shopifyDomain: true },
        });

        const user = await this.upsertOwnerUser(tx, merchant.id, input.email);

        return {
          merchantId: merchant.id,
          merchantUserId: user.id,
          shopifyDomain: merchant.shopifyDomain,
          role: user.role as MerchantRole,
          email: user.email,
        } satisfies MerchantUpsertResult;
      }),
    );

    this.logger.log(`Upserted merchant ${result.merchantId} (${result.shopifyDomain})`);
    return result;
  }

  /**
   * Find-or-create the merchant user for this email. The first user on a brand
   * new merchant is the `owner`; any later new user defaults to `staff`. An
   * existing user keeps its current role. Clerk owns the user identity record;
   * `merchant_users` is a role-mapping table, and `clerkUserId` is linked later
   * by the Clerk `organization`/`user` webhooks (null until then).
   */
  private async upsertOwnerUser(
    tx: PrismaTransaction,
    merchantId: string,
    email: string,
  ): Promise<{ id: string; email: string; role: MerchantRole }> {
    const existing = await tx.merchantUser.findUnique({
      where: { merchantId_email: { merchantId, email } },
      select: { id: true, email: true, role: true },
    });
    if (existing) {
      return { id: existing.id, email: existing.email, role: existing.role as MerchantRole };
    }

    const userCount = await tx.merchantUser.count({ where: { merchantId } });
    const role: MerchantRole = userCount === 0 ? 'owner' : 'staff';

    const created = await tx.merchantUser.create({
      data: { merchantId, email, role },
      select: { id: true, email: true, role: true },
    });
    return { id: created.id, email: created.email, role: created.role as MerchantRole };
  }

  // ── Part 2 of 4: Merchant config and settings ──────────────────────────

  async getMerchantConfig(merchantId: string): Promise<{
    shopifyDomain: string;
    gtmId: string | null;
    ga4Id: string | null;
    allowsBackOrders: boolean;
  }> {
    const merchant = await this.prisma.merchant.findUniqueOrThrow({
      where: { id: merchantId },
      select: {
        shopifyDomain: true,
        gtmId: true,
        ga4Id: true,
        allowsBackOrders: true,
      },
    });
    return merchant;
  }

  async updateMerchantSettings(
    merchantId: string,
    dto: {
      allowsBackOrders?: boolean;
      gtmId?: string;
      ga4Id?: string;
      invoicePrefix?: string;
      paymentInstructions?: string | null;
    },
    correlationId?: string,
  ): Promise<void> {
    await this.merchantContext.run(merchantId, () =>
      this.prisma.merchant.update({
        where: { id: merchantId },
        data: {
          ...(dto.allowsBackOrders !== undefined && { allowsBackOrders: dto.allowsBackOrders }),
          ...(dto.gtmId !== undefined && { gtmId: dto.gtmId }),
          ...(dto.ga4Id !== undefined && { ga4Id: dto.ga4Id }),
          ...(dto.invoicePrefix !== undefined && { invoicePrefix: dto.invoicePrefix }),
          ...(dto.paymentInstructions !== undefined && { paymentInstructions: dto.paymentInstructions }),
        },
      }),
    );

    this.logger.log('Merchant settings updated', { merchantId, correlationId });
  }
}
