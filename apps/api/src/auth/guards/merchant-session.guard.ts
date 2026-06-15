import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import type { Request } from 'express';
import type { MerchantRole } from '@b2b/shared';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MerchantContextService } from '../../prisma/merchant-context.service';

/**
 * The authenticated merchant principal attached to the request by
 * {@link MerchantSessionGuard}. A merchant admin runs inside Shopify Admin; the
 * web app authenticates them with NextAuth + Shopify OAuth and issues an HS256
 * session token (signed with NEXTAUTH_SECRET) that this API verifies. The token
 * carries the resolved merchant id, the staff user id, the Shopify domain and
 * the merchant-user role.
 */
export interface MerchantPrincipal {
  merchantId: string;
  shopifyDomain: string;
  role: MerchantRole;
  /** The `merchant_users.id` of the signed-in staff member (audit actor). */
  userId: string;
}

/** Express request augmented with the authenticated merchant principal. */
export interface MerchantAuthenticatedRequest extends Request {
  merchant?: MerchantPrincipal;
}

/** The claims the web NextAuth `jwt` callback encodes (see apps/web auth-options). */
interface MerchantJwtClaims {
  merchantId?: unknown;
  merchantUserId?: unknown;
  shopifyDomain?: unknown;
  role?: unknown;
  email?: unknown;
}

const VALID_ROLES: ReadonlySet<MerchantRole> = new Set<MerchantRole>(['owner', 'admin', 'staff']);

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') return null;
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token.trim();
}

/**
 * Validates the NextAuth JWT on every merchant request. Shopify App Bridge
 * session tokens cannot be verified by Clerk, so merchant auth is owned by
 * NextAuth + Shopify OAuth (a Shopify embedded-app requirement). This guard:
 *   1. verifies the HS256 token against NEXTAUTH_SECRET,
 *   2. extracts the merchant id and role from the verified payload,
 *   3. confirms the merchant is still active (resolved as the SYSTEM — the
 *      request has no tenant scope yet and `merchants` is RLS-protected),
 *   4. attaches `request.merchant`.
 *
 * It does NOT hold the RLS AsyncLocalStorage scope (a guard frame unwinds before
 * the handler runs); {@link TenantContextInterceptor} opens
 * `MerchantContextService.run(merchantId)` for the handler lifetime.
 */
@Injectable()
export class MerchantSessionGuard implements CanActivate {
  constructor(
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
    private readonly merchantContext: MerchantContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<MerchantAuthenticatedRequest>();

    const token = extractBearer(req);
    if (!token) {
      throw new UnauthorizedException({ code: 'MISSING_TOKEN', message: 'Missing bearer token' });
    }

    let claims: MerchantJwtClaims;
    try {
      claims = jwt.verify(token, this.config.get('NEXTAUTH_SECRET'), {
        algorithms: ['HS256'],
      }) as MerchantJwtClaims;
    } catch {
      throw new UnauthorizedException({ code: 'INVALID_TOKEN', message: 'Invalid or expired token' });
    }

    const merchantId = typeof claims.merchantId === 'string' ? claims.merchantId : null;
    const userId = typeof claims.merchantUserId === 'string' ? claims.merchantUserId : null;
    const shopifyDomain = typeof claims.shopifyDomain === 'string' ? claims.shopifyDomain : null;
    const role = this.parseRole(claims.role);
    if (!merchantId || !userId || !shopifyDomain || !role) {
      throw new UnauthorizedException({
        code: 'INVALID_TOKEN',
        message: 'Token is missing required merchant claims',
      });
    }

    const merchant = await this.merchantContext.runAsSystem(() =>
      this.prisma.merchant.findUnique({
        where: { id: merchantId },
        select: { id: true, isActive: true },
      }),
    );
    if (!merchant || !merchant.isActive) {
      throw new UnauthorizedException({
        code: 'MERCHANT_INACTIVE',
        message: 'Merchant account is inactive or no longer exists',
      });
    }

    req.merchant = { merchantId, shopifyDomain, role, userId };
    return true;
  }

  private parseRole(value: unknown): MerchantRole | null {
    return typeof value === 'string' && VALID_ROLES.has(value as MerchantRole)
      ? (value as MerchantRole)
      : null;
  }
}
