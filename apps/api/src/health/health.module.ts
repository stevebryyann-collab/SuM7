import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/** Liveness/readiness probes. Depends on global Prisma + Redis modules. */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
