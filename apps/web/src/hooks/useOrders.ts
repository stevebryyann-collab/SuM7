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
import type { OrderDetail, OrderSummary } from '@/types/api';
import type { PortalMode } from './useInvoices';

export interface UseOrdersParams {
  mode: PortalMode;
  status?: string;
  buyerId?: string;
  /** ISO date bounds (merchant only) — inclusive `createdAt` window. */
  dateFrom?: string;
  dateTo?: string;
}

export const orderKeys = {
  all: ['orders'] as const,
  list: (params: UseOrdersParams) =>
    [
      ...orderKeys.all,
      params.mode,
      params.status ?? '',
      params.buyerId ?? '',
      params.dateFrom ?? '',
      params.dateTo ?? '',
    ] as const,
  detail: (mode: PortalMode, id: string) => [...orderKeys.all, mode, 'detail', id] as const,
};

function ordersPath(params: UseOrdersParams, cursor: string | null): string {
  const base = params.mode === 'merchant' ? '/orders' : '/buyer/orders';
  const search = new URLSearchParams();
  if (cursor) search.set('cursor', cursor);
  if (params.status) search.set('status', params.status);
  if (params.mode === 'merchant') {
    if (params.buyerId) search.set('buyerId', params.buyerId);
    if (params.dateFrom) search.set('dateFrom', params.dateFrom);
    if (params.dateTo) search.set('dateTo', params.dateTo);
  }
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

/**
 * Single order detail. `mode` picks the auth client + route: merchant admin uses
 * {@link merchantFetch} + `/orders/:id`; the buyer portal uses {@link buyerFetch}
 * + `/buyer/orders/:id`. Disabled until an id is present.
 */
export function useOrder(mode: PortalMode, id: string | undefined): UseQueryResult<OrderDetail, Error> {
  const client = mode === 'merchant' ? merchantFetch : buyerFetch;
  const base = mode === 'merchant' ? '/orders' : '/buyer/orders';
  return useQuery({
    queryKey: orderKeys.detail(mode, id ?? ''),
    enabled: Boolean(id),
    queryFn: ({ signal }) => client<OrderDetail>(`${base}/${id}`, { signal }),
  });
}
