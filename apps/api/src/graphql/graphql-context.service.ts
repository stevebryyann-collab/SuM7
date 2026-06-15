import { Injectable } from '@nestjs/common';
import { GraphQLError } from 'graphql';
import * as jwt from 'jsonwebtoken';
import type { Request } from 'express';
import type { MerchantRole } from '@b2b/shared';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { MerchantContextService } from '../prisma/merchant-context.service';

/**
 * The authenticated context every GraphQL resolver receives. Built once per
 * request by {@link GraphqlContextService.build}; resolvers read `merchantId`
 * (and never trust a client-supplied id).
 */
export interface GraphqlContext {
  req: Request;
  merchantId: string;
  shopifyDomain: string;
  role: MerchantRole;
  userId: string;
}

interface MerchantJwtClaims {
  merchantId?: unknown;
  merchantUserId?: unknown;
  shopifyDomain?: unknown;
  role?: unknown;
}

const VALID_ROLES: ReadonlySet<MerchantRole> = new Set<MerchantRole>(['owner', 'admin', 'staff']);

/** Content types a JSON GraphQL endpoint must reject (CSRF hardening). */
const FORBIDDEN_CONTENT_TYPES = ['text/plain', 'multipart/form-data'];

/**
 * Authenticates GraphQL requests and assembles the resolver context. The
 * merchant admin dashboard is the only GraphQL audience, so this mirrors
 * {@link MerchantSessionGuard}: verify the NextAuth HS256 token, confirm the
 * merchant is active, and expose the tenant on the context. There is no
 * unauthenticated GraphQL execution — a missing/invalid token throws before any
 * resolver runs.
 *
 * CSRF: simple-request content types (text/plain, multipart/form-data) can be
 * sent cross-origin without a preflight, so they are rejected outright. Only
 * application/json (which triggers a CORS preflight) is allowed to mutate.
 */
@Injectable()
export class GraphqlContextService {
  constructor(
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
    private readonly merchantContext: MerchantContextService,
  ) {}

  async build(req: Request): Promise<GraphqlContext> {
    this.assertContentType(req);

    const token = this.extractBearer(req);
    if (!token) {
      throw new GraphQLError('Missing bearer token', {
        extensions: { code: 'MISSING_TOKEN', http: { status: 401 } },
      });
    }

    let claims: MerchantJwtClaims;
    try {
      claims = jwt.verify(token, this.config.get('NEXTAUTH_SECRET'), {
        algorithms: ['HS256'],
      }) as MerchantJwtClaims;
    } catch {
      throw new GraphQLError('Invalid or expired token', {
        extensions: { code: 'INVALID_TOKEN', http: { status: 401 } },
      });
    }

    const merchantId = typeof claims.merchantId === 'string' ? claims.merchantId : null;
    const userId = typeof claims.merchantUserId === 'string' ? claims.merchantUserId : null;
    const shopifyDomain = typeof claims.shopifyDomain === 'string' ? claims.shopifyDomain : null;
    const role =
      typeof claims.role === 'string' && VALID_ROLES.has(claims.role as MerchantRole)
        ? (claims.role as MerchantRole)
        : null;

    if (!merchantId || !userId || !shopifyDomain || !role) {
      throw new GraphQLError('Token is missing required merchant claims', {
        extensions: { code: 'INVALID_TOKEN', http: { status: 401 } },
      });
    }

    const merchant = await this.merchantContext.runAsSystem(() =>
      this.prisma.merchant.findUnique({ where: { id: merchantId }, select: { isActive: true } }),
    );
    if (!merchant || !merchant.isActive) {
      throw new GraphQLError('Merchant account is inactive or no longer exists', {
        extensions: { code: 'MERCHANT_INACTIVE', http: { status: 401 } },
      });
    }

    return { req, merchantId, shopifyDomain, role, userId };
  }

  private assertContentType(req: Request): void {
    // GET (APQ hash lookups, introspection in dev) carries no body to police.
    if (req.method === 'GET') return;
    const contentType = (req.headers['content-type'] ?? '').toString().toLowerCase();
    if (FORBIDDEN_CONTENT_TYPES.some((forbidden) => contentType.includes(forbidden))) {
      throw new GraphQLError('Unsupported content type', {
        extensions: { code: 'INVALID_CONTENT_TYPE', http: { status: 400 } },
      });
    }
  }

  private extractBearer(req: Request): string | null {
    const header = req.headers.authorization;
    if (!header || typeof header !== 'string') return null;
    const [scheme, value] = header.split(' ');
    if (scheme !== 'Bearer' || !value) return null;
    return value.trim();
  }
}
