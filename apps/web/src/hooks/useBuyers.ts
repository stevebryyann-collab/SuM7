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
import { dashboardKeys } from './useDashboard';

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
 * Count of pending applications, polled every 60s for the sidebar badge.
 * Reuses the known-good applications endpoint and derives the count client-side
 * (no separate count route), so it works with the demo mock layer too.
 */
export function usePendingBuyersCount(): UseQueryResult<number> {
  return useQuery({
    queryKey: [...buyerKeys.applications(), 'count'] as const,
    staleTime: 60_000,
    refetchInterval: 60_000,
    queryFn: async ({ signal }) => {
      const apps = await merchantFetch<BuyerApplication[]>('/buyers/applications?status=pending', {
        signal,
      });
      return apps.length;
    },
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
      void qc.invalidateQueries({ queryKey: dashboardKeys.all });
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
      void qc.invalidateQueries({ queryKey: dashboardKeys.all });
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

/**
 * GDPR subject-access export for one buyer (owner only). The API returns the
 * export as JSON; we wrap it in a Blob and trigger a client-side `.json` download.
 */
export function useBuyerGdprExport() {
  return useMutation({
    mutationFn: (buyerId: string) =>
      merchantFetch<Record<string, unknown>>(`/api/v1/data-export/gdpr/${buyerId}`, { method: 'GET' }),
    onSuccess: (data, buyerId) => {
      if (typeof window === 'undefined') return;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `gdpr-export-${buyerId}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    },
  });
}

/**
 * GDPR right-to-erasure for one buyer (owner only). The server requires an
 * explicit `?confirm=DELETE` guard rail and refuses while unpaid invoices remain.
 */
export function useEraseBuyer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (buyerId: string) =>
      merchantFetch<{ erased: true; timestamp: string }>(
        `/api/v1/data-export/gdpr/${buyerId}?confirm=DELETE`,
        { method: 'DELETE' },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: buyerKeys.all });
      void qc.invalidateQueries({ queryKey: merchantDashboardKeys.all });
    },
  });
}
