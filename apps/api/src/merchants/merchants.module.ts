import { Module } from '@nestjs/common';
import { MerchantsController } from './merchants.controller';
import { MerchantsService } from './merchants.service';

/**
 * Merchant administration domain (onboarding, profile, team, settings).
 *
 * Currently exposes the internal provisioning endpoint
 * (`POST /internal/merchants/upsert`) used by the web NextAuth callback. The
 * global Prisma, Crypto, and Config modules supply this module's dependencies
 * (PrismaService, MerchantContextService, EncryptionService, AppConfigService).
 */
@Module({
  controllers: [MerchantsController],
  providers: [MerchantsService],
  exports: [MerchantsService],
})
export class MerchantsModule {}
