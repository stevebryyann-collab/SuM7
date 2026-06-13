import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import type { SubscriptionTier } from '@b2b/shared';
import { REDIS_CACHE } from '../../redis/redis.module';
import type { MerchantAuthenticatedRequest } from '../../auth/guards/merchant-session.guard';
import type { BuyerAuthenticatedRequest } from '../../auth/guards/buyer-jwt.guard';

interface Limit {
  limit: number;
  windowMs: number;
}

const GLOBAL_IP_LIMIT: Limit = { limit: 200, windowMs: 60_000 };
const BUYER_LIMIT: Limit = { limit: 300, windowMs: 60 * 60_000 };
const MERCHANT_LIMITS: Record<SubscriptionTier, Limit> = {
  starter: { limit: 1000, windowMs: 60 * 60_000 },
  growth: { limit: 5000, windowMs: 60 * 60_000 },
  pro: { limit: 20000, windowMs: 60 * 60_000 },
};

const WEBHOOK_PATH = /\/webhooks(\/|$)/;

type AnyAuthRequest = MerchantAuthenticatedRequest & BuyerAuthenticatedRequest;

/**
 * Two-tier rate limiting backed by a Redis fixed window.
 *   Tier 1: 200 req/min per client IP (always).
 *   Tier 2: per authenticated entity — buyer 300/hr, or merchant by plan
 *           (starter 1k, growth 5k, pro 20k per hour).
 *
 * Webhook routes are exempt here (protected instead by Shopify HMAC + IP
 * allowlist). The per-entity tier requires the auth guard to have run first;
 * when no entity is resolved, only the IP tier applies.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(@Inject(REDIS_CACHE) private readonly cache: Redis) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AnyAuthRequest>();
    const res = context.switchToHttp().getResponse<{ setHeader(name: string, value: string): void }>();

    if (WEBHOOK_PATH.test(req.originalUrl ?? req.url ?? '')) {
      return true;
    }

    const ip = this.resolveIp(req);
    await this.enforce('ip', ip, GLOBAL_IP_LIMIT, res);

    if (req.buyer) {
      await this.enforce('buyer', req.buyer.sub, BUYER_LIMIT, res);
    } else if (req.merchant) {
      const tier = await this.resolveMerchantTier(req.merchant.merchantId);
      await this.enforce('merchant', req.merchant.merchantId, MERCHANT_LIMITS[tier], res);
    }

    return true;
  }

  private resolveIp(req: AnyAuthRequest): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      const first = forwarded.split(',')[0]?.trim();
      if (first) return first;
    }
    return req.ip ?? 'unknown';
  }

  /** Subscription tier is cached out-of-band by billing; default to starter. */
  private async resolveMerchantTier(merchantId: string): Promise<SubscriptionTier> {
    const cached = await this.cache.get(`merchant:tier:${merchantId}`);
    if (cached === 'starter' || cached === 'growth' || cached === 'pro') {
      return cached;
    }
    return 'starter';
  }

  private async enforce(
    type: 'ip' | 'merchant' | 'buyer',
    identifier: string,
    { limit, windowMs }: Limit,
    res: { setHeader(name: string, value: string): void },
  ): Promise<void> {
    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const key = `throttle:${type}:${identifier}:${windowStart}`;

    const count = await this.cache.incr(key);
    if (count === 1) {
      await this.cache.pexpire(key, windowMs);
    }

    if (count > limit) {
      const retryAfter = Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      res.setHeader('X-RateLimit-Limit', String(limit));
      res.setHeader('X-RateLimit-Remaining', '0');
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Rate limit exceeded for ${type}`,
          retryAfterSeconds: retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
