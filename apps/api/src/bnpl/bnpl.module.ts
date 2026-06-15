import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BnplService } from './bnpl.service';
import { BnplController } from './bnpl.controller';
import { ResolveAdapter } from './adapters/resolve.adapter';

/**
 * B2B BNPL via Resolve (US, Phase 1), always behind the {@link BnplAdapter}
 * interface so business logic never touches the Resolve SDK directly. Wires the
 * Resolve adapter (circuit-breaker-wrapped HTTP, HMAC webhook verification), the
 * provider-routing service, and the buyer/webhook controller. Prisma, Redis,
 * Email, Config, CircuitBreaker and Invoices are global modules; AuthModule
 * supplies the ClerkBuyerGuard used on the buyer routes.
 */
@Module({
  imports: [AuthModule],
  controllers: [BnplController],
  providers: [BnplService, ResolveAdapter],
  exports: [BnplService],
})
export class BnplModule {}
