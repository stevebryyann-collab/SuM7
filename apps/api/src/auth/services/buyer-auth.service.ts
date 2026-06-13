import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Redis } from 'ioredis';
import { generateJti, generateSecureToken, hashToken } from '@b2b/shared';
import type { BuyerTokenPayload } from '@b2b/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { MerchantContextService } from '../../prisma/merchant-context.service';
import { AppConfigService } from '../../config/app-config.service';
import { REDIS_CACHE } from '../../redis/redis.module';

const ACCESS_TTL_SECONDS = 15 * 60; // 15 minutes
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_LOGIN_FAILURES = 10;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const AUDIENCE = 'b2b-wholesale-buyer';
const ISSUER = 'b2b-wholesale-api';

/** Request metadata captured for audit + token binding. */
export interface AuthRequestMeta {
  userAgent?: string;
  ipAddress?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** Access-token lifetime in seconds (for client scheduling). */
  expiresIn: number;
  buyerId: string;
  merchantId: string;
}

/** 429 with a machine-readable retry hint; the controller sets Retry-After. */
export class AccountLockedException extends HttpException {
  constructor(public readonly retryAfterSeconds: number) {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: 'ACCOUNT_LOCKED',
        message: 'Account temporarily locked due to failed login attempts',
        retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

@Injectable()
export class BuyerAuthService {
  private readonly logger = new Logger(BuyerAuthService.name);
  /** Constant dummy hash compared against when a buyer is absent (anti-enumeration). */
  private readonly dummyHash = bcrypt.hashSync(generateSecureToken(16), 12);

  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantContext: MerchantContextService,
    private readonly config: AppConfigService,
    @Inject(REDIS_CACHE) private readonly cache: Redis,
  ) {}

  private get privateKey(): string {
    return this.config.get('AUTH_PRIVATE_KEY').replace(/\\n/g, '\n');
  }

  private jtiKey(buyerId: string, merchantId: string, jti: string): string {
    return `buyer:jti:${buyerId}:${merchantId}:${jti}`;
  }

  /**
   * Authenticate a buyer for a specific merchant. Returns a fresh token pair.
   * Failure modes are deliberately uniform (generic 401) to prevent account
   * enumeration, except lockout (429) which clients must surface to the user.
   */
  async login(
    email: string,
    password: string,
    merchantId: string,
    meta: AuthRequestMeta,
  ): Promise<TokenPair> {
    const normalizedEmail = email.trim().toLowerCase();

    // Buyer + relationship live behind cross-merchant access control; query as
    // system and enforce isolation with explicit WHERE clauses.
    const buyer = await this.merchantContext.runAsSystem(() =>
      this.prisma.buyer.findUnique({ where: { email: normalizedEmail } }),
    );

    // GDPR-erased or missing accounts: compare against the dummy hash so the
    // timing profile matches a real verification, then fail generically.
    if (!buyer || buyer.anonymizedAt) {
      await bcrypt.compare(password, this.dummyHash);
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' });
    }

    if (buyer.lockedUntil && buyer.lockedUntil.getTime() > Date.now()) {
      const retryAfterSeconds = Math.ceil((buyer.lockedUntil.getTime() - Date.now()) / 1000);
      throw new AccountLockedException(retryAfterSeconds);
    }

    const passwordValid = await bcrypt.compare(password, buyer.passwordHash);
    if (!passwordValid) {
      await this.registerLoginFailure(buyer.id, buyer.loginFailCount);
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' });
    }

    // Approval is per-merchant; an approved buyer at merchant A is not
    // automatically approved at merchant B.
    const relationship = await this.merchantContext.runAsSystem(() =>
      this.prisma.merchantBuyerRelationship.findUnique({
        where: { merchantId_buyerId: { merchantId, buyerId: buyer.id } },
        select: { approvalStatus: true, pricingTierId: true },
      }),
    );

    if (!relationship || relationship.approvalStatus !== 'approved') {
      throw new ForbiddenException({
        code: 'BUYER_NOT_APPROVED',
        message: 'Your account is not approved for this store',
      });
    }

    // Reset lockout counters and stamp the login.
    await this.merchantContext.runAsSystem(() =>
      this.prisma.buyer.update({
        where: { id: buyer.id },
        data: { loginFailCount: 0, lockedUntil: null, lastLoginAt: new Date() },
      }),
    );

    return this.generateTokenPair(buyer.id, merchantId, relationship.pricingTierId, meta);
  }

  private async registerLoginFailure(buyerId: string, currentCount: number): Promise<void> {
    const nextCount = currentCount + 1;
    const shouldLock = nextCount >= MAX_LOGIN_FAILURES;
    await this.merchantContext.runAsSystem(() =>
      this.prisma.buyer.update({
        where: { id: buyerId },
        data: {
          loginFailCount: nextCount,
          lockedUntil: shouldLock ? new Date(Date.now() + LOCK_DURATION_MS) : null,
        },
      }),
    );
  }

  /**
   * Mint a new RS256 access token + opaque refresh token, persisting the refresh
   * token hash and registering the access-token jti in the Redis allowlist (so it
   * can be revoked before its 15-minute natural expiry).
   */
  async generateTokenPair(
    buyerId: string,
    merchantId: string,
    pricingTierId: string | null,
    meta: AuthRequestMeta,
  ): Promise<TokenPair> {
    const jti = generateJti();

    const accessToken = jwt.sign(
      { merchantId, pricingTierId } satisfies Pick<BuyerTokenPayload, 'merchantId' | 'pricingTierId'>,
      this.privateKey,
      {
        algorithm: 'RS256',
        expiresIn: ACCESS_TTL_SECONDS,
        audience: AUDIENCE,
        issuer: ISSUER,
        subject: buyerId,
        jwtid: jti,
      },
    );

    const refreshToken = generateSecureToken(32);
    const tokenHash = hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);

    await this.merchantContext.runAsSystem(() =>
      this.prisma.refreshToken.create({
        data: {
          buyerId,
          merchantId,
          tokenHash,
          expiresAt,
          userAgent: meta.userAgent ?? null,
          ipAddress: meta.ipAddress ?? null,
        },
      }),
    );

    // Allowlist the jti; guard checks this so revocation is immediate.
    await this.cache.set(this.jtiKey(buyerId, merchantId, jti), '1', 'EX', ACCESS_TTL_SECONDS);

    return { accessToken, refreshToken, expiresIn: ACCESS_TTL_SECONDS, buyerId, merchantId };
  }

  /**
   * Rotate a refresh token. Implements reuse detection: presenting a token that
   * has already been rotated (replacedByHash set) means the token was stolen —
   * we revoke the buyer's entire session family and reject.
   */
  async refresh(refreshToken: string, meta: AuthRequestMeta): Promise<TokenPair> {
    const tokenHash = hashToken(refreshToken);

    const stored = await this.merchantContext.runAsSystem(() =>
      this.prisma.refreshToken.findUnique({ where: { tokenHash } }),
    );

    if (!stored) {
      throw new UnauthorizedException({ code: 'INVALID_REFRESH_TOKEN', message: 'Invalid refresh token' });
    }

    // Reuse of an already-rotated token → breach. Burn everything.
    if (stored.replacedByHash !== null) {
      await this.revokeAllSessions(stored.buyerId, stored.merchantId);
      this.logger.warn(
        `Refresh token reuse detected for buyer=${stored.buyerId} merchant=${stored.merchantId}; revoked all sessions`,
      );
      throw new UnauthorizedException({
        code: 'TOKEN_REUSE_DETECTED',
        message: 'Session security violation; please sign in again',
      });
    }

    if (stored.revokedAt !== null) {
      throw new UnauthorizedException({ code: 'INVALID_REFRESH_TOKEN', message: 'Invalid refresh token' });
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException({ code: 'REFRESH_TOKEN_EXPIRED', message: 'Refresh token expired' });
    }

    // Resolve current pricing tier for the new access token.
    const relationship = await this.merchantContext.runAsSystem(() =>
      this.prisma.merchantBuyerRelationship.findUnique({
        where: { merchantId_buyerId: { merchantId: stored.merchantId, buyerId: stored.buyerId } },
        select: { approvalStatus: true, pricingTierId: true },
      }),
    );

    if (!relationship || relationship.approvalStatus !== 'approved') {
      throw new ForbiddenException({ code: 'BUYER_NOT_APPROVED', message: 'Account not approved' });
    }

    const pair = await this.generateTokenPair(
      stored.buyerId,
      stored.merchantId,
      relationship.pricingTierId,
      meta,
    );

    // Atomically retire the old token, linking it to its replacement.
    await this.merchantContext.runAsSystem(() =>
      this.prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date(), replacedByHash: hashToken(pair.refreshToken) },
      }),
    );

    return pair;
  }

  /**
   * Revoke every active refresh token for a buyer/merchant and purge their
   * access-token jti allowlist so existing access tokens stop validating.
   */
  async revokeAllSessions(buyerId: string, merchantId: string): Promise<void> {
    await this.merchantContext.runAsSystem(() =>
      this.prisma.refreshToken.updateMany({
        where: { buyerId, merchantId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    );

    const pattern = this.jtiKey(buyerId, merchantId, '*');
    const stream = this.cache.scanStream({ match: pattern, count: 100 });
    await new Promise<void>((resolve, reject) => {
      const pending: Array<Promise<number>> = [];
      stream.on('data', (keys: string[]) => {
        if (keys.length > 0) pending.push(this.cache.del(...keys));
      });
      stream.on('end', () => {
        Promise.all(pending)
          .then(() => resolve())
          .catch(reject);
      });
      stream.on('error', reject);
    });
  }

  /** True when an access token's jti is still in the allowlist (not revoked). */
  async isJtiActive(buyerId: string, merchantId: string, jti: string): Promise<boolean> {
    const exists = await this.cache.exists(this.jtiKey(buyerId, merchantId, jti));
    return exists === 1;
  }
}
