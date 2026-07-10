import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { SystemHealthController } from './system-health.controller';
import { AuthModule } from '../auth/auth.module';

/**
 * Liveness/readiness probes plus the merchant-facing System Health aggregator.
 * Depends on global Prisma + Redis + CircuitBreaker + Queue modules; imports
 * AuthModule for the merchant session/roles guards on {@link SystemHealthController}.
 */
@Module({
  imports: [AuthModule],
  controllers: [HealthController, SystemHealthController],
})
export class HealthModule {}
