import { Controller, Get } from '@nestjs/common';
import { QueueHealthService, type QueueHealthReport } from './queue-health.service';

/**
 * Internal observability endpoint exposing live BullMQ queue metrics (depths,
 * dead letters, average completion time). No auth — mounted under /health for
 * internal probes / dashboards only; keep it off the public ingress.
 */
@Controller('health/queues')
export class QueueHealthController {
  constructor(private readonly queueHealth: QueueHealthService) {}

  @Get()
  report(): Promise<QueueHealthReport> {
    return this.queueHealth.getReport();
  }
}
