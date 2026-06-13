import { Module } from '@nestjs/common';
import { BuyerAuthService } from './services/buyer-auth.service';
import { BuyerJwtGuard } from './guards/buyer-jwt.guard';
import { MerchantSessionGuard } from './guards/merchant-session.guard';

/**
 * Authentication building blocks shared across feature modules:
 *   - BuyerAuthService: buyer login / RS256 token issuance / refresh rotation
 *   - BuyerJwtGuard:     stateless buyer access-token verification
 *   - MerchantSessionGuard: NextAuth HS256 session verification
 *
 * Depends on the global Prisma, Redis, Crypto and Config modules.
 */
@Module({
  providers: [BuyerAuthService, BuyerJwtGuard, MerchantSessionGuard],
  exports: [BuyerAuthService, BuyerJwtGuard, MerchantSessionGuard],
})
export class AuthModule {}
