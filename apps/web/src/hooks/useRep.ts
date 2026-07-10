'use client';

import {
  useInfiniteQuery,
  useMutation,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';
import { merchantFetch } from '@/lib/api/merchant';

/** A buyer row in the sales-rep portal list (GET /rep/buyers). */
export interface RepBuyer {
  buyerId: string;
  companyName: string;
  email: string;
  pricingTierName: string | null;
  paymentTerms: string;
  lastOrderAt: string | null;
  totalOrderCount: number;
  outstandingBalance: string;
  creditUsed: string;
  creditLimit: string | null;
}

export interface RepBuyersPage {
  buyers: RepBuyer[];
  nextCursor: string | null;
}

/** A single order in a rep's per-buyer order history (GET /rep/buyers/:id/orders). */
export interface RepBuyerOrder {
  id: string;
  shopifyOrderNumber: string | null;
  createdAt: string;
  itemCount: number;
  total: string;
  currency: string;
  status: string;
  syncStatus: string;
  invoiceStatus: string | null;
  invoiceNumber: string | null;
}

export interface RepBuyerOrdersPage {
  orders: RepBuyerOrder[];
  nextCursor: string | null;
}

/** Response of POST /rep/sessions — the minted impersonation token. */
export interface StartRepSessionResponse {
  sessionToken: string;
  expiresAt: string;
  buyerCompanyName: string;
  buyerEmail: string;
}

export const repKeys = {
  all: ['rep'] as const,
  buyers: (search: string) => [...repKeys.all, 'buyers', search] as const,
  buyerOrders: (buyerId: string) => [...repKeys.all, 'buyerOrders', buyerId] as const,
};

function repBuyersPath(search: string, cursor: string | null): string {
  const qs = new URLSearchParams();
  if (cursor) qs.set('cursor', cursor);
  if (search) qs.set('search', search);
  const s = qs.toString();
  return `/rep/buyers${s ? `?${s}` : ''}`;
}

/** Cursor-paginated approved-buyer list for the rep portal. */
export function useRepBuyers(
  search = '',
): UseInfiniteQueryResult<InfiniteData<RepBuyersPage>, Error> {
  return useInfiniteQuery({
    queryKey: repKeys.buyers(search.trim().toLowerCase()),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      merchantFetch<RepBuyersPage>(repBuyersPath(search.trim(), pageParam), { signal }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** Cursor-paginated order history for one buyer (rep view). */
export function useRepBuyerOrders(
  buyerId: string,
): UseInfiniteQueryResult<InfiniteData<RepBuyerOrdersPage>, Error> {
  return useInfiniteQuery({
    queryKey: repKeys.buyerOrders(buyerId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const qs = pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : '';
      return merchantFetch<RepBuyerOrdersPage>(`/rep/buyers/${buyerId}/orders${qs}`, { signal });
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** Start an impersonation session for a buyer (POST /rep/sessions). */
export function useStartRepSession() {
  return useMutation({
    mutationFn: (buyerId: string) =>
      merchantFetch<StartRepSessionResponse>('/rep/sessions', {
        method: 'POST',
        body: { buyerId },
      }),
  });
}
