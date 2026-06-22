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
import type { ApproveBuyerInput, RejectBuyerInput, UpdateBuyerInput } from '@b2b/shared/schemas';
import type { PaginatedResponse } from '@b2b/shared/types';
import { merchantFetch } from '@/lib/api/merchant';
import type { ApplicationPii, BuyerApplication, BuyerDetail, BuyerSummary } from '@/types/api';
import { merchantDashboardKeys } from './useMerchantDashboard';

export const buyerKeys = {
  all: ['buyers'] as const,
  list: (filters: BuyersListFilters) =>
    [...buyerKeys.all, 'list', filters.approvalStatus ?? '', filters.searchQuery ?? ''] as const,
  applications: () => [...buyerKeys.all, 'applications'] as const,
  detail: (buyerId: string) => [...buyerKeys.all, 'detail', buyerId] as const,
};

export interface BuyersListFilters {
  approvalStatus?: string;
  pricingTierId?: string;
  searchQuery?: string;
}

function buyersPath(filters: BuyersListFilters, cursor: string | null): string {
  const search = new URLSearchParams();
  if (cursor) search.set('cursor', cursor);
  if (filters.approvalStatus) search.set('approvalStatus', filters.approvalStatus);
  if (filters.pricingTierId) search.set('pricingTierId', filters.pricingTierId);
  if (filters.searchQuery) search.set('searchQuery', filters.searchQuery);
  const qs = search.toString();
  return `/buyers${qs ? `?${qs}` : ''}`;
}

/** Cursor-paginated buyers list with per-buyer aggregates (merchant admin). */
export function useBuyers(
  filters: BuyersListFilters = {},
): UseInfiniteQueryResult<InfiniteData<PaginatedResponse<BuyerSummary>>, Error> {
  return useInfiniteQuery({
    queryKey: buyerKeys.list(filters),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      merchantFetch<PaginatedResponse<BuyerSummary>>(buyersPath(filters, pageParam), { signal }),
    getNextPageParam: (lastPage) =>
      lastPage.pageInfo.hasNextPage ? lastPage.pageInfo.endCursor : undefined,
  });
}

/** Pending registration applications awaiting merchant review. */
export function usePendingApplications(): UseQueryResult<BuyerApplication[]> {
  return useQuery({
    queryKey: buyerKeys.applications(),
    staleTime: 30_000,
    queryFn: ({ signal }) =>
      merchantFetch<BuyerApplication[]>('/buyers/applications?status=pending', { signal }),
  });
}

/**
 * Full per-buyer detail (View panel + approved-buyer inline edit). Disabled
 * until a buyerId is supplied so the slide-over only fetches when opened.
 */
export function useBuyerDetail(buyerId: string | null): UseQueryResult<BuyerDetail> {
  return useQuery({
    queryKey: buyerKeys.detail(buyerId ?? ''),
    enabled: buyerId !== null,
    queryFn: ({ signal }) => merchantFetch<BuyerDetail>(`/buyers/${buyerId}`, { signal }),
  });
}

/** Approve a pending application with tier/terms/credit-limit. */
export function useApproveBuyer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ApproveBuyerInput) =>
      merchantFetch<void>(`/buyers/applications/${input.applicationId}/approve`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: buyerKeys.all });
      void qc.invalidateQueries({ queryKey: merchantDashboardKeys.all });
    },
  });
}

/** Reject a pending application with a required reason. */
export function useRejectBuyer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RejectBuyerInput) =>
      merchantFetch<void>(`/buyers/applications/${input.applicationId}/reject`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: buyerKeys.all });
      void qc.invalidateQueries({ queryKey: merchantDashboardKeys.all });
    },
  });
}

/** Suspend an approved buyer (revokes their portal access). */
export function useSuspendBuyer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (buyerId: string) =>
      merchantFetch<void>(`/buyers/${buyerId}/suspend`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: buyerKeys.all });
    },
  });
}

/** Reinstate a suspended buyer (suspended → approved). 409 NOT_SUSPENDED otherwise. */
export function useReinstateBuyer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (buyerId: string) =>
      merchantFetch<void>(`/buyers/${buyerId}/reinstate`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: buyerKeys.all });
    },
  });
}

/** Update an approved buyer's relationship config (tier / terms / credit / notes). */
export function useUpdateBuyer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ buyerId, input }: { buyerId: string; input: UpdateBuyerInput }) =>
      merchantFetch<void>(`/buyers/${buyerId}`, { method: 'PATCH', body: input }),
    onSuccess: (_data, { buyerId }) => {
      void qc.invalidateQueries({ queryKey: buyerKeys.all });
      void qc.invalidateQueries({ queryKey: buyerKeys.detail(buyerId) });
    },
  });
}

/**
 * Reveal an application's PII (taxId, phone) via the audited endpoint. Returned
 * as a mutation (not a query): each reveal is an explicit, audited action and
 * the plaintext is intentionally never cached.
 */
export function useRevealApplicationPii() {
  return useMutation({
    mutationFn: (applicationId: string) =>
      merchantFetch<ApplicationPii>(`/buyers/applications/${applicationId}/reveal`, {
        method: 'POST',
      }),
  });
}
