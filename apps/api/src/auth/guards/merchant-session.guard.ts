import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import type { Request } from 'express';
import type { MerchantRole, MerchantSession } from '@b2b/shared';
import { AppConfigService } from '../../config/app-config.service';

/** Express request augmented with the authenticated merchant session. */
export interface MerchantAuthenticatedRequest extends Request {
  merchant?: MerchantSession;
}

const VALID_ROLES: readonly MerchantRole[] = ['owner', 'admin', 'staff'];

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim();
  }
  // Fallback: the NextAuth session cookie (prod uses the __Secure- prefix).
  const cookies = req.headers.cookie;
  if (cookies) {
    for (const part of cookies.split(';')) {
      const [name, ...rest] = part.trim().split('=');
      if (name === '__Secure-next-auth.session-token' || name === 'next-auth.session-token') {
        return decodeURIComponent(rest.join('='));
      }
    }
  }
  return null;
}

function toSession(payload: jwt.JwtPayload): MerchantSession | null {
  const merchantId = payload.merchantId;
  const shopifyDomain = payload.shopifyDomain;
  const role = payload.role;
  const merchantUserId = payload.sub;
  const email = payload.email;
  if (
    typeof merchantId !== 'string' ||
    typeof shopifyDomain !== 'string' ||
    typeof merchantUserId !== 'string' ||
    typeof email !== 'string' ||
    typeof role !== 'string' ||
    !VALID_ROLES.includes(role as MerchantRole)
  ) {
    return null;
  }
  return { merchantId, merchantUserId, shopifyDomain, role: role as MerchantRole, email };
}

/**
 * Authenticates merchant-admin requests by verifying the NextAuth-issued HS256
 * JWT (signed with NEXTAUTH_SECRET; see apps/web's custom jwt.encode/decode).
 *
 * The guard attaches `request.merchant`. It does NOT open the RLS
 * AsyncLocalStorage scope — a guard's stack frame unwinds before the route
 * handler runs, so the scope would close too early. TenantContextInterceptor
 * opens that scope for the request lifetime using `request.merchant`.
 */
@Injectable()
export class MerchantSessionGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<MerchantAuthenticatedRequest>();
    const token = extractToken(req);
    if (!token) {
      throw new UnauthorizedException({ code: 'MISSING_SESSION', message: 'Not authenticated' });
    }

    let decoded: string | jwt.JwtPayload;
    try {
      decoded = jwt.verify(token, this.config.get('NEXTAUTH_SECRET'), {
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException({ code: 'INVALID_SESSION', message: 'Invalid session' });
    }

    if (typeof decoded === 'string') {
      throw new UnauthorizedException({ code: 'INVALID_SESSION', message: 'Invalid session' });
    }

    const session = toSession(decoded);
    if (!session) {
      throw new UnauthorizedException({ code: 'INVALID_SESSION', message: 'Malformed session claims' });
    }

    req.merchant = session;
    return true;
  }
}
