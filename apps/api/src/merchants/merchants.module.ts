import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MerchantsController } from './merchants.controller';
import { SettingsController } from './settings.controller';
import { TeamController } from './team.controller';
import { MerchantsService } from './merchants.service';

/**
 * Merchant administration domain (onboarding, profile, team, settings).
 *
 * Exposes the internal provisioning endpoint (`POST /internal/merchants/upsert`,
 * used by the web NextAuth callback) plus the merchant-facing settings
 * (`/api/v1/settings`) and team management (`/api/v1/team`, owner only)
 * surfaces. AuthModule supplies the merchant session + roles guards; the global
 * Prisma, Crypto, and Config modules supply PrismaService,
 * MerchantContextService, EncryptionService and AppConfigService.
 */
@Module({
  imports: [AuthModule],
  controllers: [MerchantsController, SettingsController, TeamController],
  providers: [MerchantsService],
  exports: [MerchantsService],
})
export class MerchantsModule {}
