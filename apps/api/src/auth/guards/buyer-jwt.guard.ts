import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import type { Request } from 'express';
import type { BuyerTokenPayload } from '@b2b/shared';
import { AppConfigService } from '../../config/app-config.service';
import { BuyerAuthService } from '../services/buyer-auth.service';

const AUDIENCE = 'b2b-wholesale-buyer';
const ISSUER = 'b2b-wholesale-api';

/** Express request augmented with the authenticated buyer. */
export interface BuyerAuthenticatedRequest extends Request {
  buyer?: BuyerTokenPayload;
}

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') return null;
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token.trim();
}

function isBuyerPayload(value: unknown): value is BuyerTokenPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.sub === 'string' &&
    typeof v.merchantId === 'string' &&
    typeof v.jti === 'string' &&
    (v.pricingTierId === null || typeof v.pricingTierId === 'string') &&
    v.aud === AUDIENCE &&
    v.iss === ISSUER &&
    typeof v.iat === 'number' &&
    typeof v.exp === 'number'
  );
}

/**
 * Stateless buyer authentication. Verifies the RS256 signature with the public
 * key and the standard claims (exp/aud/iss) — no database hit. Revocation is
 * enforced via a Redis jti allowlist (a cache hit, not a DB hit), so signing
 * out / breach response takes effect before the 15-minute token expiry.
 */
@Injectable()
export class BuyerJwtGuard implements CanActivate {
  constructor(
    private readonly config: AppConfigService,
    private readonly buyerAuth: BuyerAuthService,
  ) {}

  private get publicKey(): string {
    return this.config.get('AUTH_PUBLIC_KEY').replace(/\\n/g, '\n');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<BuyerAuthenticatedRequest>();
    const token = extractBearer(req);
    if (!token) {
      throw new UnauthorizedException({ code: 'MISSING_TOKEN', message: 'Missing bearer token' });
    }

    let decoded: string | jwt.JwtPayload;
    try {
      decoded = jwt.verify(token, this.publicKey, {
        algorithms: ['RS256'],
        audience: AUDIENCE,
        issuer: ISSUER,
      });
    } catch {
      throw new UnauthorizedException({ code: 'INVALID_TOKEN', message: 'Invalid or expired token' });
    }

    if (!isBuyerPayload(decoded)) {
      throw new UnauthorizedException({ code: 'INVALID_TOKEN', message: 'Malformed token claims' });
    }

    const active = await this.buyerAuth.isJtiActive(decoded.sub, decoded.merchantId, decoded.jti);
    if (!active) {
      throw new UnauthorizedException({ code: 'TOKEN_REVOKED', message: 'Session has been revoked' });
    }

    req.buyer = decoded;
    return true;
  }
}
