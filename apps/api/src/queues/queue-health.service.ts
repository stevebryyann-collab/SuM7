import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as Sentry from '@sentry/node';
import {
  QUEUE_BUYER,
  QUEUE_CATALOG,
  QUEUE_INVOICE,
  QUEUE_MERCHANT,
  QUEUE_ORDER,
} from './queue.module';

/** Per-queue operational metrics surfaced at /health/queues. */
export interface QueueMetrics {
  name: string;
  active: number;
  waiting: number;
  delayed: number;
  failed: number;
  /** Jobs that exhausted every retry (attemptsMade ≥ configured attempts). */
  deadLetterDepth: number;
  /** Mean processing time over the last 100 completed jobs (ms), or null. */
  averageCompletionMs: number | null;
}

export interface QueueHealthReport {
  checkedAt: string;
  queues: QueueMetrics[];
}

/** Queues whose backlog of dead letters is page-worthy. */
const CRITICAL_QUEUES = new Set([QUEUE_INVOICE, QUEUE_ORDER]);
const DEAD_LETTER_ALERT_THRESHOLD = 10;
const COMPLETION_SAMPLE_SIZE = 100;
const FAILED_SCAN_LIMIT = 1000;

/**
 * Aggregates BullMQ queue metrics for health checks and alerting. Computes dead
 * letter depth (fully-exhausted failed jobs), live active/waiting/delayed
 * counts, and average completion time over a recent sample. Raises a Sentry
 * alert when the invoice or order dead-letter backlog exceeds the threshold.
 */
@Injectable()
export class QueueHealthService {
  private readonly logger = new Logger(QueueHealthService.name);
  private readonly queues: ReadonlyArray<{ name: string; queue: Queue }>;

  constructor(
    @InjectQueue(QUEUE_INVOICE) invoice: Queue,
    @InjectQueue(QUEUE_ORDER) order: Queue,
    @InjectQueue(QUEUE_CATALOG) catalog: Queue,
    @InjectQueue(QUEUE_BUYER) buyer: Queue,
    @InjectQueue(QUEUE_MERCHANT) merchant: Queue,
  ) {
    this.queues = [
      { name: QUEUE_INVOICE, queue: invoice },
      { name: QUEUE_ORDER, queue: order },
      { name: QUEUE_CATALOG, queue: catalog },
      { name: QUEUE_BUYER, queue: buyer },
      { name: QUEUE_MERCHANT, queue: merchant },
    ];
  }

  /** Collect metrics for every queue and alert on critical dead-letter backlogs. */
  async getReport(): Promise<QueueHealthReport> {
    const queues = await Promise.all(this.queues.map(({ name, queue }) => this.metricsFor(name, queue)));

    for (const metrics of queues) {
      if (CRITICAL_QUEUES.has(metrics.name) && metrics.deadLetterDepth > DEAD_LETTER_ALERT_THRESHOLD) {
        this.logger.error(
          `[queue:${metrics.name}] dead-letter depth ${metrics.deadLetterDepth} exceeds threshold`,
        );
        Sentry.captureMessage(`Queue dead-letter backlog: ${metrics.name}`, {
          level: 'error',
          tags: { component: 'queue-health', queue: metrics.name },
          extra: { deadLetterDepth: metrics.deadLetterDepth, failed: metrics.failed },
        });
      }
    }

    return { checkedAt: new Date().toISOString(), queues };
  }

  private async metricsFor(name: string, queue: Queue): Promise<QueueMetrics> {
    const counts = await queue.getJobCounts('active', 'waiting', 'delayed', 'failed', 'completed');
    const [deadLetterDepth, averageCompletionMs] = await Promise.all([
      this.countDeadLetters(queue),
      this.averageCompletion(queue),
    ]);

    return {
      name,
      active: counts.active ?? 0,
      waiting: counts.waiting ?? 0,
      delayed: counts.delayed ?? 0,
      failed: counts.failed ?? 0,
      deadLetterDepth,
      averageCompletionMs,
    };
  }

  /** Count failed jobs that have used up all their configured attempts. */
  private async countDeadLetters(queue: Queue): Promise<number> {
    const failed = await queue.getFailed(0, FAILED_SCAN_LIMIT - 1);
    return failed.filter((job) => job.attemptsMade >= (job.opts.attempts ?? 1)).length;
  }

  /** Mean (finishedOn − processedOn) over the most recent completed jobs. */
  private async averageCompletion(queue: Queue): Promise<number | null> {
    const completed = await queue.getCompleted(0, COMPLETION_SAMPLE_SIZE - 1);
    const durations = completed
      .map((job) =>
        typeof job.finishedOn === 'number' && typeof job.processedOn === 'number'
          ? job.finishedOn - job.processedOn
          : null,
      )
      .filter((value): value is number => value !== null && value >= 0);

    if (durations.length === 0) {
      return null;
    }
    const total = durations.reduce((sum, value) => sum + value, 0);
    return Math.round(total / durations.length);
  }
}
