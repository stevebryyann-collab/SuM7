import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BuyersService } from './buyers.service';
import { BuyersController } from './buyers.controller';

/**
 * Buyer domain: self-serve registration applications, the merchant approval
 * workflow, buyer listing, suspension, and GDPR export/erasure. Imports
 * AuthModule for the merchant/buyer guards used by {@link BuyersController}.
 * {@link BuyersService} is exported so the data-export (analytics) controller
 * can reuse the GDPR export/erase logic. Prisma, Redis, Email and Config are
 * global modules and need no explicit import here.
 */
@Module({
  imports: [AuthModule],
  controllers: [BuyersController],
  providers: [BuyersService],
  exports: [BuyersService],
})
export class BuyersModule {}
