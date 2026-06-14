import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { verifyToken } from '@clerk/backend';
import type { Request } from 'express';
import type { PaymentTerms } from '@b2b/shared';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MerchantContextService } from '../../prisma/merchant-context.service';

/**
 * The authenticated buyer principal attached to the request by
 * {@link ClerkBuyerGuard}. Buyers are unified cross-merchant Clerk users; the
 * per-merchant configuration (tier, terms, approval) lives on the relationship.
 */
export interface BuyerPrincipal {
  buyerId: string;
  clerkUserId: string;
  merchantId: string;
  pricingTierId: string | null;
  paymentTerms: PaymentTerms;
}

/** Express request augmented with the authenticated buyer principal. */
export interface BuyerAuthenticatedRequest extends Request {
  buyer?: BuyerPrincipal;
}

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') return null;
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token.trim();
}

/** Read a single cookie value from the raw Cookie header (no cookie-parser dep). */
function readCookie(req: Request, name: string): string | null {
  const cookies = req.headers.cookie;
  if (!cookies) return null;
  for (const part of cookies.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      return decodeURIComponent(rest.join('='));
    }
  }
  return null;
}

/**
 * Authenticates buyer-portal requests. Clerk verifies the session token; the
 * merchant tenant is supplied by the `__merchant_id` cookie set by the App
 * Proxy middleware (the buyer always sees the merchant's own Shopify domain).
 *
 * Beyond signature verification this guard makes ONE database query per request
 * to enforce the per-merchant relationship state (relationship existence,
 * approval status, GDPR erasure). That single read is intentional and accepted.
 * The query is scoped to the merchant so RLS on `merchant_buyer_relationships`
 * is satisfied; `buyers` carries no RLS (unified cross-merchant identity).
 */
@Injectable()
export class ClerkBuyerGuard implements CanActivate {
  constructor(
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
    private readonly merchantContext: MerchantContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<BuyerAuthenticatedRequest>();

    const token = extractBearer(req);
    if (!token) {
      throw new UnauthorizedException({ code: 'MISSING_TOKEN', message: 'Missing bearer token' });
    }

    const merchantId = readCookie(req, '__merchant_id');
    if (!merchantId) {
      throw new UnauthorizedException({
        code: 'NO_MERCHANT_CONTEXT',
        message: 'Missing merchant context cookie',
      });
    }

    let payload: Awaited<ReturnType<typeof verifyToken>>;
    try {
      payload = await verifyToken(token, { secretKey: this.config.get('CLERK_SECRET_KEY') });
    } catch {
      throw new UnauthorizedException({ code: 'INVALID_TOKEN', message: 'Invalid or expired token' });
    }

    const relationship = await this.merchantContext.run(merchantId, () =>
      this.prisma.merchantBuyerRelationship.findFirst({
        where: { merchantId, buyer: { clerkUserId: payload.sub } },
        select: {
          buyerId: true,
          approvalStatus: true,
          pricingTierId: true,
          paymentTerms: true,
          buyer: { select: { anonymizedAt: true } },
        },
      }),
    );

    if (!relationship) {
      throw new ForbiddenException({
        code: 'NO_RELATIONSHIP',
        message: 'No relationship with this merchant',
      });
    }
    if (relationship.approvalStatus === 'suspended') {
      throw new ForbiddenException({ code: 'BUYER_SUSPENDED', message: 'Account suspended' });
    }
    if (relationship.approvalStatus !== 'approved') {
      throw new ForbiddenException({ code: 'BUYER_NOT_APPROVED', message: 'Account not approved' });
    }
    if (relationship.buyer.anonymizedAt) {
      throw new UnauthorizedException({ code: 'ACCOUNT_ERASED', message: 'Account has been erased' });
    }

    req.buyer = {
      buyerId: relationship.buyerId,
      clerkUserId: payload.sub,
      merchantId,
      pricingTierId: relationship.pricingTierId,
      paymentTerms: relationship.paymentTerms,
    };
    return true;
  }
}
