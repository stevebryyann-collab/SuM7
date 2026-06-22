'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { merchantFetch } from '@/lib/api/merchant';
import type { DashboardData } from '@/types/api';

export const dashboardKeys = {
  all: ['dashboard'] as const,
};

/**
 * The merchant dashboard aggregator — KPIs, AR aging, 30-day GMV trend, recent
 * invoices, pending applications and onboarding flags in one request. 60s
 * staleTime: the figures are aggregates that tolerate brief staleness.
 */
export function useDashboard(): UseQueryResult<DashboardData> {
  return useQuery({
    queryKey: dashboardKeys.all,
    staleTime: 60_000,
    queryFn: ({ signal }) => merchantFetch<DashboardData>('/api/v1/dashboard', { signal }),
  });
}
