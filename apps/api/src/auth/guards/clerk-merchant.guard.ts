import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { verifyToken } from '@clerk/backend';
import type { Request } from 'express';
import type { SubscriptionTier } from '@b2b/shared';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MerchantContextService } from '../../prisma/merchant-context.service';

/**
 * The authenticated merchant principal attached to the request by
 * {@link ClerkMerchantGuard}. Clerk organizations map 1:1 to merchants, so the
 * org id on the verified session token resolves the tenant.
 */
export interface MerchantPrincipal {
  merchantId: string;
  clerkOrgId: string;
  /** Clerk organization role (e.g. `org:admin`), taken from `org_role`. */
  role: string;
  /** Clerk user id of the signed-in staff member (`sub`). */
  clerkUserId: string;
  subscriptionTier: SubscriptionTier;
}

/** Express request augmented with the authenticated merchant principal. */
export interface MerchantAuthenticatedRequest extends Request {
  merchant?: MerchantPrincipal;
}

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') return null;
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token.trim();
}

/**
 * Authenticates merchant-admin requests by verifying the Clerk-issued session
 * token (Clerk owns token signing, refresh rotation and brute-force defence).
 * Our responsibility is purely authorization context:
 *   1. verify the token with the Clerk secret key,
 *   2. require an organization (`org_id`) on the session,
 *   3. resolve the active merchant for that org and attach `request.merchant`.
 *
 * The merchant lookup runs as the SYSTEM (bypass RLS): the request has no tenant
 * scope yet, and `merchants` is itself an RLS-protected table that would
 * otherwise fail closed. The guard attaches the principal but does NOT hold the
 * RLS AsyncLocalStorage scope — a guard frame unwinds before the handler runs.
 * TenantContextInterceptor opens `MerchantContextService.run(merchantId)` for
 * the handler lifetime using `request.merchant.merchantId`.
 */
@Injectable()
export class ClerkMerchantGuard implements CanActivate {
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

    let payload: Awaited<ReturnType<typeof verifyToken>>;
    try {
      payload = await verifyToken(token, { secretKey: this.config.get('CLERK_SECRET_KEY') });
    } catch {
      throw new UnauthorizedException({ code: 'INVALID_TOKEN', message: 'Invalid or expired token' });
    }

    const orgId = payload.org_id;
    if (typeof orgId !== 'string' || orgId.length === 0) {
      throw new UnauthorizedException({
        code: 'NO_ORG_CONTEXT',
        message: 'Session is not scoped to an organization',
      });
    }

    const merchant = await this.merchantContext.runAsSystem(() =>
      this.prisma.merchant.findUnique({
        where: { clerkOrgId: orgId },
        select: { id: true, isActive: true, subscriptionTier: true },
      }),
    );

    // An inactive merchant (e.g. app uninstalled) is treated as not found so no
    // information leaks about suspended tenants.
    if (!merchant || !merchant.isActive) {
      throw new UnauthorizedException({
        code: 'MERCHANT_NOT_FOUND',
        message: 'No active merchant for this organization',
      });
    }

    req.merchant = {
      merchantId: merchant.id,
      clerkOrgId: orgId,
      role: typeof payload.org_role === 'string' ? payload.org_role : '',
      clerkUserId: payload.sub,
      subscriptionTier: merchant.subscriptionTier,
    };
    return true;
  }
}
