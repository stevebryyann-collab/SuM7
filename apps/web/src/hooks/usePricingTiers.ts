'use client';

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  BulkPricingOverrideInput,
  CreatePricingTierInput,
  UpdatePricingTierInput,
} from '@b2b/shared/schemas';
import type { PaginatedResponse } from '@b2b/shared/types';
import { merchantFetch } from '@/lib/api/merchant';
import type {
  PricingOverrideSummary,
  PricingTierDetail,
  PricingTierSummary,
} from '@/types/api';

const BASE = '/api/v1/pricing-tiers';

export const pricingTierKeys = {
  all: ['pricing-tiers'] as const,
  list: () => [...pricingTierKeys.all, 'list'] as const,
  detail: (id: string) => [...pricingTierKeys.all, 'detail', id] as const,
  overrides: (id: string) => [...pricingTierKeys.all, 'detail', id, 'overrides'] as const,
};

/**
 * Merchant pricing tiers. 5m staleTime — tiers change infrequently and are
 * reused across the approval panel (tier <select>) and the pricing admin page.
 * Note the API mounts this resource under `/api/v1/pricing-tiers`.
 */
export function usePricingTiers(): UseQueryResult<PricingTierSummary[]> {
  return useQuery({
    queryKey: pricingTierKeys.list(),
    staleTime: 300_000,
    queryFn: ({ signal }) => merchantFetch<PricingTierSummary[]>(BASE, { signal }),
  });
}

/**
 * Single tier detail (header + conditions + first page of overrides). Disabled
 * until an id is supplied. Overrides beyond the first page are fetched via
 * {@link useTierOverrides}.
 */
export function usePricingTierDetail(id: string | null): UseQueryResult<PricingTierDetail> {
  return useQuery({
    queryKey: pricingTierKeys.detail(id ?? ''),
    enabled: id !== null,
    queryFn: ({ signal }) => merchantFetch<PricingTierDetail>(`${BASE}/${id}`, { signal }),
  });
}

/**
 * Cursor-paginated overrides for a tier (the detail page's override table).
 * The API has no standalone overrides list — overrides are paginated through the
 * detail endpoint itself (`GET /:id?cursor=`), so each page is the tier detail
 * narrowed to its `overrides` envelope.
 */
export function useTierOverrides(
  id: string | null,
): UseInfiniteQueryResult<InfiniteData<PaginatedResponse<PricingOverrideSummary>>, Error> {
  return useInfiniteQuery({
    queryKey: pricingTierKeys.overrides(id ?? ''),
    enabled: id !== null,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const detail = await merchantFetch<PricingTierDetail>(
        `${BASE}/${id}${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`,
        { signal },
      );
      return detail.overrides;
    },
    getNextPageParam: (lastPage) =>
      lastPage.pageInfo.hasNextPage ? lastPage.pageInfo.endCursor : undefined,
  });
}

/** Create a pricing tier. Reuses the shared CreatePricingTierSchema for validation. */
export function useCreatePricingTier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePricingTierInput) =>
      merchantFetch<{ id: string }>(BASE, { method: 'POST', body: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pricingTierKeys.all });
    },
  });
}

/** Update a pricing tier. */
export function useUpdatePricingTier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdatePricingTierInput }) =>
      merchantFetch<void>(`${BASE}/${id}`, { method: 'PATCH', body: input }),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: pricingTierKeys.all });
      void qc.invalidateQueries({ queryKey: pricingTierKeys.detail(id) });
    },
  });
}

/** Delete a pricing tier (owner only; 409 TIER_HAS_ACTIVE_BUYERS if assigned). */
export function useDeletePricingTier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => merchantFetch<void>(`${BASE}/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pricingTierKeys.all });
    },
  });
}

/** Bulk-upsert per-variant price overrides for a tier. */
export function useBulkOverrides() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: BulkPricingOverrideInput }) =>
      merchantFetch<{ upserted: number }>(`${BASE}/${id}/overrides/bulk`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: pricingTierKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: pricingTierKeys.overrides(id) });
    },
  });
}

/** Delete a single override from a tier. */
export function useDeleteOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, overrideId }: { id: string; overrideId: string }) =>
      merchantFetch<void>(`${BASE}/${id}/overrides/${overrideId}`, { method: 'DELETE' }),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: pricingTierKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: pricingTierKeys.overrides(id) });
    },
  });
}
