import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { MerchantContextService } from '../prisma/merchant-context.service';
import { verifyMerchantContextToken } from './merchant-context-token';

/** Header carrying the signed merchant-context token from the buyer portal. */
export const MERCHANT_CONTEXT_HEADER = 'x-merchant-context';

/** The tenant resolved from a verified merchant-context token. */
export interface ResolvedMerchant {
  merchantId: string;
  shopifyDomain: string;
}

/**
 * Resolves the buyer's merchant tenant from the signed `X-Merchant-Context`
 * header (minted by the web Edge middleware after an App-Proxy signature
 * verification). This replaces the previous, broken reliance on a cross-domain
 * `__merchant_id` cookie that never reached the cross-origin API.
 *
 * Resolution is a single indexed lookup on `merchants.shopifyDomain` run in the
 * system context (the merchants table carries no RLS — it is the tenant root).
 * Only ACTIVE merchants resolve, so a deactivated store cannot be targeted.
 */
@Injectable()
export class MerchantResolverService {
  constructor(
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
    private readonly merchantContext: MerchantContextService,
  ) {}

  /**
   * Resolve the merchant tenant for a buyer-portal request. Throws 401
   * `NO_MERCHANT_CONTEXT` when the header is absent, malformed, mis-signed,
   * expired, or names an unknown/inactive shop. Never falls back silently — a
   * missing tenant is a hard failure for every buyer core flow.
   */
  async resolveFromRequest(req: Request): Promise<ResolvedMerchant> {
    const header = req.headers[MERCHANT_CONTEXT_HEADER];
    const token = Array.isArray(header) ? header[0] : header;

    const claims = verifyMerchantContextToken(token, this.config.get('SHOPIFY_CLIENT_SECRET'));
    if (!claims) {
      throw new UnauthorizedException({
        code: 'NO_MERCHANT_CONTEXT',
        message: 'Missing or invalid merchant context',
      });
    }

    const merchant = await this.merchantContext.runAsSystem(() =>
      this.prisma.merchant.findFirst({
        where: { shopifyDomain: claims.shop, isActive: true },
        select: { id: true, shopifyDomain: true },
      }),
    );
    if (!merchant) {
      throw new UnauthorizedException({
        code: 'NO_MERCHANT_CONTEXT',
        message: 'Unknown or inactive merchant',
      });
    }

    return { merchantId: merchant.id, shopifyDomain: merchant.shopifyDomain };
  }
}
