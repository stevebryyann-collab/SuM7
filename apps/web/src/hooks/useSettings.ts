'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { UpdateMerchantSettingsInput } from '@b2b/shared/schemas';
import { merchantFetch } from '@/lib/api/merchant';
import type { MerchantSettings } from '@/types/api';

export const settingsKeys = {
  all: ['settings'] as const,
};

/** Merchant general/invoice/notification settings. 5m staleTime (rarely changes). */
export function useSettings(): UseQueryResult<MerchantSettings> {
  return useQuery({
    queryKey: settingsKeys.all,
    staleTime: 300_000,
    queryFn: ({ signal }) => merchantFetch<MerchantSettings>('/api/v1/settings', { signal }),
  });
}

/** Save invoice + notification settings (the full object is sent each time). */
export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateMerchantSettingsInput) =>
      merchantFetch<MerchantSettings>('/api/v1/settings', { method: 'PUT', body: input }),
    onSuccess: (data) => {
      qc.setQueryData(settingsKeys.all, data);
    },
  });
}

/** Buyer-portal analytics integration IDs (GTM container + GA4 measurement). */
export interface AnalyticsSettingsInput {
  gtmId?: string;
  ga4Id?: string;
}

/**
 * Persist the buyer-portal analytics IDs via PATCH /merchants/settings (owner /
 * admin only, enforced server-side). Written through to the merchant record and
 * read by the buyer portal's GTM/GA4 bootstrap.
 */
export function useUpdateAnalyticsSettings() {
  return useMutation({
    mutationFn: (input: AnalyticsSettingsInput) =>
      merchantFetch<void>('/merchants/settings', { method: 'PATCH', body: input }),
  });
}
