'use client';

import {
  useInfiniteQuery,
  useQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { PaginatedResponse } from '@b2b/shared/types';
import { merchantFetch } from '@/lib/api/merchant';
import { buyerFetch } from '@/lib/api/buyer';
import type { InvoiceDetail, InvoiceSummary } from '@/types/api';

export type PortalMode = 'merchant' | 'buyer';

export interface UseInvoicesParams {
  mode: PortalMode;
  status?: string;
  /** AR aging bucket filter (merchant only), e.g. `current`, `1-30`, `90-plus`. */
  agingBucket?: string;
  buyerId?: string;
}

export const invoiceKeys = {
  all: ['invoices'] as const,
  list: (params: UseInvoicesParams) =>
    [...invoiceKeys.all, params.mode, params.status ?? '', params.agingBucket ?? '', params.buyerId ?? ''] as const,
  detail: (id: string) => [...invoiceKeys.all, 'detail', id] as const,
};

/** Compose the cursor-paginated invoices path for the chosen portal/filters. */
function invoicesPath(params: UseInvoicesParams, cursor: string | null): string {
  const base = params.mode === 'merchant' ? '/invoices' : '/buyer/invoices';
  const search = new URLSearchParams();
  if (cursor) search.set('cursor', cursor);
  if (params.status) search.set('status', params.status);
  if (params.mode === 'merchant') {
    if (params.agingBucket) search.set('agingBucket', params.agingBucket);
    if (params.buyerId) search.set('buyerId', params.buyerId);
  }
  const qs = search.toString();
  return `${base}${qs ? `?${qs}` : ''}`;
}

/**
 * Infinite invoice list. The `mode` discriminator selects the auth client and
 * route: merchant admin uses {@link merchantFetch} + `/invoices`; the buyer
 * portal uses {@link buyerFetch} + `/buyer/invoices`. The two auth systems are
 * never mixed.
 */
export function useInvoices(
  params: UseInvoicesParams,
): UseInfiniteQueryResult<InfiniteData<PaginatedResponse<InvoiceSummary>>, Error> {
  const client = params.mode === 'merchant' ? merchantFetch : buyerFetch;
  return useInfiniteQuery({
    queryKey: invoiceKeys.list(params),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      client<PaginatedResponse<InvoiceSummary>>(invoicesPath(params, pageParam), { signal }),
    getNextPageParam: (lastPage) =>
      lastPage.pageInfo.hasNextPage ? lastPage.pageInfo.endCursor : undefined,
  });
}

/**
 * Single invoice detail for the merchant admin (`GET /invoices/:id`). Carries the
 * header, line items, derived payment history and the recent audit trail.
 * Disabled until an id is present.
 */
export function useInvoice(id: string | undefined): UseQueryResult<InvoiceDetail, Error> {
  return useQuery({
    queryKey: invoiceKeys.detail(id ?? ''),
    enabled: Boolean(id),
    queryFn: ({ signal }) => merchantFetch<InvoiceDetail>(`/invoices/${id}`, { signal }),
  });
}
