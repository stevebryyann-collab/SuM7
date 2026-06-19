'use client';

import { useInfiniteQuery, type UseInfiniteQueryResult, type InfiniteData } from '@tanstack/react-query';
import type { PaginatedResponse } from '@b2b/shared/types';
import { merchantFetch } from '@/lib/api/merchant';
import { buyerFetch } from '@/lib/api/buyer';
import type { OrderSummary } from '@/types/api';
import type { PortalMode } from './useInvoices';

export interface UseOrdersParams {
  mode: PortalMode;
  status?: string;
  buyerId?: string;
}

export const orderKeys = {
  all: ['orders'] as const,
  list: (params: UseOrdersParams) =>
    [...orderKeys.all, params.mode, params.status ?? '', params.buyerId ?? ''] as const,
};

function ordersPath(params: UseOrdersParams, cursor: string | null): string {
  const base = params.mode === 'merchant' ? '/orders' : '/buyer/orders';
  const search = new URLSearchParams();
  if (cursor) search.set('cursor', cursor);
  if (params.status) search.set('status', params.status);
  if (params.mode === 'merchant' && params.buyerId) search.set('buyerId', params.buyerId);
  const qs = search.toString();
  return `${base}${qs ? `?${qs}` : ''}`;
}

/**
 * Infinite order list. Same merchant/buyer mode pattern as {@link useInvoices}:
 * the discriminator picks the auth client and route.
 */
export function useOrders(
  params: UseOrdersParams,
): UseInfiniteQueryResult<InfiniteData<PaginatedResponse<OrderSummary>>, Error> {
  const client = params.mode === 'merchant' ? merchantFetch : buyerFetch;
  return useInfiniteQuery({
    queryKey: orderKeys.list(params),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      client<PaginatedResponse<OrderSummary>>(ordersPath(params, pageParam), { signal }),
    getNextPageParam: (lastPage) =>
      lastPage.pageInfo.hasNextPage ? lastPage.pageInfo.endCursor : undefined,
  });
}
