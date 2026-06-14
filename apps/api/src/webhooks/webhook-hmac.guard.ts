import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  type RawBodyRequest,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { MerchantContextService } from '../prisma/merchant-context.service';

/** Resolved Shopify webhook context attached to the request once verified. */
export interface ShopifyWebhookContext {
  shopifyDomain: string;
  merchantId: string;
}

/** Express request augmented with the verified Shopify webhook context. */
export interface ShopifyWebhookRequest extends RawBodyRequest<Request> {
  shopifyWebhook?: ShopifyWebhookContext;
}

/** Max permitted clock skew between Shopify's stated creation time and now. */
const MAX_WEBHOOK_AGE_MS = 300_000;

/**
 * Hardened Shopify webhook gate. THREE independent checks, all of which must
 * pass before any handler runs:
 *
 *   1. HMAC-SHA256 of the RAW body keyed by SHOPIFY_CLIENT_SECRET, base64, then
 *      compared in constant time against `X-Shopify-Hmac-Sha256`.
 *   2. Replay window: |now − X-Shopify-Webhook-Created-At| ≤ 300s.
 *   3. `X-Shopify-Shop-Domain` must resolve to an active merchant in the DB.
 *
 * Any failure throws 401 with a specific code. The resolved merchant is attached
 * to the request so the controller never has to re-query it.
 */
@Injectable()
export class WebhookHmacGuard implements CanActivate {
  constructor(
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
    private readonly merchantContext: MerchantContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ShopifyWebhookRequest>();

    // ── Check 1: HMAC ────────────────────────────────────────────────────
    const raw = req.rawBody;
    if (!raw) {
      throw new UnauthorizedException({ code: 'MISSING_BODY', message: 'Raw body unavailable' });
    }
    const provided = req.headers['x-shopify-hmac-sha256'];
    if (typeof provided !== 'string' || provided.length === 0) {
      throw new UnauthorizedException({ code: 'MISSING_HMAC', message: 'Missing HMAC header' });
    }
    const expected = createHmac('sha256', this.config.get('SHOPIFY_CLIENT_SECRET'))
      .update(raw)
      .digest('base64');
    const expectedBuf = Buffer.from(expected);
    const providedBuf = Buffer.from(provided);
    if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
      throw new UnauthorizedException({ code: 'INVALID_HMAC', message: 'HMAC verification failed' });
    }

    // ── Check 2: replay window ───────────────────────────────────────────
    const createdAtHeader = req.headers['x-shopify-webhook-created-at'];
    if (typeof createdAtHeader !== 'string') {
      throw new UnauthorizedException({
        code: 'WEBHOOK_STALE',
        message: 'Missing webhook timestamp',
      });
    }
    const createdAtMs = Date.parse(createdAtHeader);
    if (Number.isNaN(createdAtMs) || Math.abs(Date.now() - createdAtMs) > MAX_WEBHOOK_AGE_MS) {
      throw new UnauthorizedException({
        code: 'WEBHOOK_STALE',
        message: 'Webhook timestamp outside the allowed replay window',
      });
    }

    // ── Check 3: known active merchant ───────────────────────────────────
    const domain = req.headers['x-shopify-shop-domain'];
    if (typeof domain !== 'string' || domain.length === 0) {
      throw new UnauthorizedException({ code: 'UNKNOWN_MERCHANT', message: 'Missing shop domain' });
    }
    const merchant = await this.merchantContext.runAsSystem(() =>
      this.prisma.merchant.findFirst({
        where: { shopifyDomain: domain, isActive: true },
        select: { id: true },
      }),
    );
    if (!merchant) {
      throw new UnauthorizedException({
        code: 'UNKNOWN_MERCHANT',
        message: 'No active merchant for this shop domain',
      });
    }

    req.shopifyWebhook = { shopifyDomain: domain, merchantId: merchant.id };
    return true;
  }
}
