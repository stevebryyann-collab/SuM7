'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { SubscriptionTier } from '@b2b/shared/types';
import { merchantFetch } from '@/lib/api/merchant';
import type { BillingPlan, BillingUsage } from '@/types/api';

const BASE = '/api/v1/billing';

export const billingKeys = {
  all: ['billing'] as const,
  plan: () => [...billingKeys.all, 'plan'] as const,
  usage: () => [...billingKeys.all, 'usage'] as const,
};

/** Current plan snapshot (tier, status, price, next billing date). */
export function useBillingPlan(): UseQueryResult<BillingPlan> {
  return useQuery({
    queryKey: billingKeys.plan(),
    staleTime: 60_000,
    queryFn: ({ signal }) => merchantFetch<BillingPlan>(`${BASE}/plan`, { signal }),
  });
}

/** Current-month metered GMV usage against the tier's free threshold. */
export function useBillingUsage(): UseQueryResult<BillingUsage> {
  return useQuery({
    queryKey: billingKeys.usage(),
    staleTime: 60_000,
    queryFn: ({ signal }) => merchantFetch<BillingUsage>(`${BASE}/usage`, { signal }),
  });
}

/** Change the subscription tier (proration applied immediately). */
export function useChangePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tier: SubscriptionTier) =>
      merchantFetch<{ subscriptionId: string; tier: SubscriptionTier }>(`${BASE}/change-plan`, {
        method: 'POST',
        body: { tier },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: billingKeys.all });
    },
  });
}

/** Open the Stripe Billing Portal in a new tab. */
export function useCreatePortalSession() {
  return useMutation({
    mutationFn: () =>
      merchantFetch<{ url: string }>(`${BASE}/create-portal-session`, { method: 'POST' }),
    onSuccess: ({ url }) => {
      if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer');
    },
  });
}
