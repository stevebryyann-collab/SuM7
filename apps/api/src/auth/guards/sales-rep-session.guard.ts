import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { MerchantContextService } from '../../prisma/merchant-context.service';
import { SalesRepService } from '../services/sales-rep.service';
import { ClerkBuyerGuard, type BuyerAuthenticatedRequest } from './clerk-buyer.guard';

/** Attribution of the rep acting behind an impersonated buyer principal. */
export interface SalesRepImpersonation {
  repId: string;
  sessionId: string;
}

/** Buyer request that MAY have been opened by a sales rep on the buyer's behalf. */
export interface SalesRepImpersonationRequest extends BuyerAuthenticatedRequest {
  salesRepSession?: SalesRepImpersonation;
}

const REP_SESSION_HEADER = 'x-sales-rep-session';

/**
 * Buyer-portal guard that transparently supports sales-rep impersonation. When
 * the request carries a valid `X-Sales-Rep-Session` header it resolves the
 * session, loads the impersonated buyer's relationship, and populates
 * `request.buyer` with the BUYER's principal (so every buyer route behaves
 * exactly as it would for a real buyer) plus `request.salesRepSession` for
 * attribution. When the header is absent or invalid it delegates to the normal
 * {@link ClerkBuyerGuard}, so the same routes serve real buyers unchanged.
 *
 * The relationship read happens as the SYSTEM: the tenant is only known once the
 * session resolves, and `merchant_buyer_relationships` is RLS-protected.
 */
@Injectable()
export class SalesRepSessionGuard implements CanActivate {
  constructor(
    private readonly salesRep: SalesRepService,
    private readonly clerkBuyerGuard: ClerkBuyerGuard,
    private readonly prisma: PrismaService,
    private readonly merchantContext: MerchantContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<SalesRepImpersonationRequest>();
    const token = this.extractRepToken(req);

    if (!token) {
      return this.clerkBuyerGuard.canActivate(context);
    }

    const session = await this.salesRep.validateRepSession(token);
    if (!session) {
      // Expired/ended/forged rep token → fall back to normal buyer auth so a
      // genuinely logged-in buyer is never locked out by a stale header.
      return this.clerkBuyerGuard.canActivate(context);
    }

    const relationship = await this.merchantContext.runAsSystem(() =>
      this.prisma.merchantBuyerRelationship.findFirst({
        where: {
          merchantId: session.merchantId,
          buyerId: session.buyerId,
          approvalStatus: 'approved',
        },
        select: {
          pricingTierId: true,
          paymentTerms: true,
          buyer: { select: { clerkUserId: true, anonymizedAt: true } },
        },
      }),
    );

    // Buyer was suspended/erased after the session opened → drop to buyer auth.
    if (!relationship || relationship.buyer.anonymizedAt) {
      return this.clerkBuyerGuard.canActivate(context);
    }

    req.buyer = {
      buyerId: session.buyerId,
      // No Clerk identity is involved in impersonation; keep the buyer's own id
      // when present, otherwise mark the principal as rep-originated.
      clerkUserId: relationship.buyer.clerkUserId ?? `rep-session:${session.repId}`,
      merchantId: session.merchantId,
      pricingTierId: relationship.pricingTierId,
      paymentTerms: relationship.paymentTerms,
    };
    req.salesRepSession = { repId: session.repId, sessionId: session.sessionId };
    return true;
  }

  private extractRepToken(req: Request): string | null {
    const header = req.headers[REP_SESSION_HEADER];
    const value = Array.isArray(header) ? header[0] : header;
    if (!value || typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
}
