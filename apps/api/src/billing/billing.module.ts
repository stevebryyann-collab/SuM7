import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { BillingService } from "./billing.service";
import { BillingController } from "./billing.controller";

/**
 * Paddle billing (Merchant of Record): flat recurring subscription per tier +
 * one-time GMV overage charges with per-tier free thresholds. Maintains the
 * merchant:tier:* cache the rate-limit guard reads. Wires {@link BillingService}
 * (Paddle behind the shared circuit breaker) and {@link BillingController}.
 * Prisma, Redis, Email, Config and CircuitBreaker are global modules; AuthModule
 * provides the merchant guards. {@link BillingService} is exported so billing
 * flows can be invoked from other modules.
 */
@Module({
  imports: [AuthModule],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
