'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { merchantFetch } from '@/lib/api/merchant';

export type ServiceStatus = 'up' | 'down';
export type BreakerState = 'open' | 'half-open' | 'closed';

export interface BreakerSnapshot {
  name: string;
  state: BreakerState;
  stats: {
    fires: number;
    successes: number;
    failures: number;
    fallbacks: number;
    timeouts: number;
  };
}

export interface QueueMetrics {
  name: string;
  active: number;
  waiting: number;
  delayed: number;
  failed: number;
  deadLetterDepth: number;
  averageCompletionMs: number | null;
}

export interface SystemHealthReport {
  checkedAt: string;
  services: {
    database: ServiceStatus;
    redisCache: ServiceStatus;
    redisQueue: ServiceStatus;
  };
  breakers: BreakerSnapshot[];
  queues: QueueMetrics[];
}

export interface WebhookStats {
  windowHours: number;
  total: number;
  processed: number;
  failed: number;
  processingRatePct: number | null;
  avgProcessingMs: number | null;
  lastReceivedAt: string | null;
}

export const healthKeys = {
  all: ['system-health'] as const,
  report: () => [...healthKeys.all, 'report'] as const,
  webhooks: () => [...healthKeys.all, 'webhooks'] as const,
};

/**
 * Merchant-facing system health snapshot (owner/admin). Composes the internal
 * readiness/breaker/queue probes behind the merchant session guard. Auto-refreshes
 * every 30s so the page stays live without a websocket.
 */
export function useSystemHealth(): UseQueryResult<SystemHealthReport> {
  return useQuery({
    queryKey: healthKeys.report(),
    queryFn: ({ signal }) => merchantFetch<SystemHealthReport>('/system-health', { signal }),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

/** Last-24h webhook-processing stats for the merchant's Shopify domain (60s server cache). */
export function useWebhookStats(): UseQueryResult<WebhookStats> {
  return useQuery({
    queryKey: healthKeys.webhooks(),
    queryFn: ({ signal }) => merchantFetch<WebhookStats>('/webhooks/stats', { signal }),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}
