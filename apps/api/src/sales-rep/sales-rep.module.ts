import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SalesRepController } from './sales-rep.controller';

/**
 * Merchant-facing sales-rep portal routes. The SalesRepService and the
 * impersonation guard live in AuthModule (the guard is reused on buyer routes),
 * so this module only contributes the controller.
 */
@Module({
  imports: [AuthModule],
  controllers: [SalesRepController],
})
export class SalesRepModule {}
