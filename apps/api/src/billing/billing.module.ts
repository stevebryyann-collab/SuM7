import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';

/**
 * Hybrid billing: flat Stripe subscription + metered GMV usage records with
 * per-tier free thresholds. Maintains the merchant:tier:* cache the rate-limit
 * guard reads. Wires {@link BillingService} (Stripe behind the shared circuit
 * breaker, deterministic idempotency keys) and {@link BillingController}.
 * Prisma, Redis, Email, Config and CircuitBreaker are global modules; AuthModule
 * provides the merchant guards. {@link BillingService} is exported so the GMV
 * metering can be invoked from invoice settlement flows.
 */
@Module({
  imports: [AuthModule],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
