import { Injectable, Logger } from '@nestjs/common';
import { type MerchantRole, type UpsertMerchantInput } from '@b2b/shared';
import { PrismaService, type PrismaTransaction } from '../prisma/prisma.service';
import { MerchantContextService } from '../prisma/merchant-context.service';
import { EncryptionService } from '../crypto/encryption.service';

/** Result returned to the internal merchant-provisioning caller. */
export interface MerchantUpsertResult {
  merchantId: string;
  merchantUserId: string;
  shopifyDomain: string;
  role: MerchantRole;
  email: string;
}

@Injectable()
export class MerchantsService {
  private readonly logger = new Logger(MerchantsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantContext: MerchantContextService,
    private readonly encryption: EncryptionService,
  ) {}

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
}
