import { Module } from '@nestjs/common';
import { ClerkMerchantGuard } from './guards/clerk-merchant.guard';
import { ClerkBuyerGuard } from './guards/clerk-buyer.guard';
import { ClerkWebhooksController } from './clerk-webhooks.controller';

/**
 * Authentication building blocks shared across feature modules. Clerk owns token
 * signing, refresh rotation and brute-force protection; we own authorization
 * context (org → merchant resolution, buyer approval / GDPR checks, RLS).
 *
 *   - ClerkMerchantGuard:      verifies the Clerk org session, resolves the merchant.
 *   - ClerkBuyerGuard:         verifies the Clerk user session + relationship state.
 *   - ClerkWebhooksController: Svix-verified Clerk → platform sync (org/user links).
 *
 * Depends on the global Prisma, Crypto and Config modules.
 */
@Module({
  controllers: [ClerkWebhooksController],
  providers: [ClerkMerchantGuard, ClerkBuyerGuard],
  exports: [ClerkMerchantGuard, ClerkBuyerGuard],
})
export class AuthModule {}
