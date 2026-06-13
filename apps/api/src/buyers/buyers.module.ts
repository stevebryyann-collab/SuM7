import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';

/**
 * Buyer domain (registration applications, approval workflow, buyer portal
 * profile). Imports AuthModule for buyer login/refresh. Bootable scaffold —
 * controllers/services added by the Buyers feature task.
 */
@Module({
  imports: [AuthModule],
})
export class BuyersModule {}
