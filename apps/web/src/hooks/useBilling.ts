"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { SubscriptionTier } from "@b2b/shared/types";
import { merchantFetch } from "@/lib/api/merchant";
import type { BillingPlan, BillingUsage } from "@/types/api";

const BASE = "/api/v1/billing";

export const billingKeys = {
  all: ["billing"] as const,
  plan: () => [...billingKeys.all, "plan"] as const,
  usage: () => [...billingKeys.all, "usage"] as const,
};

/** Current plan snapshot (tier, status, price, next billing date). */
export function useBillingPlan(): UseQueryResult<BillingPlan> {
  return useQuery({
    queryKey: billingKeys.plan(),
    staleTime: 60_000,
    queryFn: ({ signal }) =>
      merchantFetch<BillingPlan>(`${BASE}/plan`, { signal }),
  });
}

/** Current-month metered GMV usage against the tier's free threshold. */
export function useBillingUsage(): UseQueryResult<BillingUsage> {
  return useQuery({
    queryKey: billingKeys.usage(),
    staleTime: 60_000,
    queryFn: ({ signal }) =>
      merchantFetch<BillingUsage>(`${BASE}/usage`, { signal }),
  });
}

/** Response of POST /change-plan: a Paddle checkout URL for a first subscription, or the new tier for an in-place (prorated) change. */
export interface ChangePlanResponse {
  checkoutUrl?: string;
  tier?: SubscriptionTier;
}

/**
 * Change the subscription tier. For a merchant with no Paddle subscription yet
 * (e.g. on trial), the backend returns a hosted-checkout URL — Paddle can't
 * create a subscription server-side — which we open in a new tab. For an
 * existing subscriber the change is applied server-side with immediate
 * proration and we just refresh the billing queries.
 */
export function useChangePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tier: SubscriptionTier) =>
      merchantFetch<ChangePlanResponse>(`${BASE}/change-plan`, {
        method: "POST",
        body: { tier },
      }),
    onSuccess: (data) => {
      if (data.checkoutUrl) {
        if (typeof window !== "undefined") {
          window.open(data.checkoutUrl, "_blank", "noopener,noreferrer");
        }
        return;
      }
      void qc.invalidateQueries({ queryKey: billingKeys.all });
    },
  });
}

/** Open the Paddle customer portal in a new tab. */
export function useCreatePortalSession() {
  return useMutation({
    mutationFn: () =>
      merchantFetch<{ url: string }>(`${BASE}/create-portal-session`, {
        method: "POST",
      }),
    onSuccess: ({ url }) => {
      if (typeof window !== "undefined")
        window.open(url, "_blank", "noopener,noreferrer");
    },
  });
}
