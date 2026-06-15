import { Module } from '@nestjs/common';
import { MerchantSessionGuard } from './guards/merchant-session.guard';
import { RolesGuard } from './guards/roles.guard';
import { ClerkBuyerGuard } from './guards/clerk-buyer.guard';
import { ClerkAuthenticatedGuard } from './guards/clerk-authenticated.guard';
import { ClerkWebhooksController } from './clerk-webhooks.controller';

/**
 * Authentication building blocks shared across feature modules. The two user
 * types have fundamentally different identity contexts (a Shopify embedded-app
 * requirement), so their guards never mix:
 *
 *   - MerchantSessionGuard:     verifies the NextAuth + Shopify OAuth session
 *                               (HS256, NEXTAUTH_SECRET), resolves the merchant.
 *   - RolesGuard:               enforces `@Roles(...)` against the merchant role.
 *   - ClerkBuyerGuard:          verifies the Clerk buyer session + relationship state.
 *   - ClerkAuthenticatedGuard:  verifies the Clerk session only (pre-approval routes).
 *   - ClerkWebhooksController:  Svix-verified Clerk → platform sync (buyer links).
 *
 * Depends on the global Prisma, Crypto and Config modules.
 */
@Module({
  controllers: [ClerkWebhooksController],
  providers: [MerchantSessionGuard, RolesGuard, ClerkBuyerGuard, ClerkAuthenticatedGuard],
  exports: [MerchantSessionGuard, RolesGuard, ClerkBuyerGuard, ClerkAuthenticatedGuard],
})
export class AuthModule {}
