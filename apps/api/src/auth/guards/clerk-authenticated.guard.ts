import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { verifyToken } from '@clerk/backend';
import type { Request } from 'express';
import { AppConfigService } from '../../config/app-config.service';

/**
 * The authenticated (but not necessarily approved) buyer identity attached by
 * {@link ClerkAuthenticatedGuard}. Used on pre-approval routes — most notably
 * the registration `apply` endpoint — where the buyer has a Clerk session but no
 * merchant relationship yet.
 */
export interface BuyerIdentity {
  clerkUserId: string;
  email: string | null;
}

/** Express request augmented with the authenticated buyer identity. */
export interface BuyerIdentityRequest extends Request {
  buyerIdentity?: BuyerIdentity;
}

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') return null;
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token.trim();
}

/**
 * Verifies a Clerk session token without checking merchant approval. The buyer
 * is authenticated (Clerk owns sign-in, brute-force defence and token rotation)
 * but may not yet have an approved relationship with any merchant — so this
 * guard is used only on the pre-approval surface (the apply endpoint). Routes
 * that require approval use {@link ClerkBuyerGuard} instead.
 */
@Injectable()
export class ClerkAuthenticatedGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<BuyerIdentityRequest>();

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

    const email = typeof payload.email === 'string' ? payload.email : null;
    req.buyerIdentity = { clerkUserId: payload.sub, email };
    return true;
  }
}
