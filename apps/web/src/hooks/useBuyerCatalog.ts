'use client';

import {
  useInfiniteQuery,
  useQuery,
  type UseInfiniteQueryResult,
  type UseQueryResult,
  type InfiniteData,
} from '@tanstack/react-query';
import { buyerFetch } from '@/lib/api/buyer';
import type { CatalogPage, CatalogProduct } from '@/types/api';

export const buyerCatalogKeys = {
  all: ['buyer-catalog'] as const,
  list: (search: string) => [...buyerCatalogKeys.all, 'list', search] as const,
  product: (handle: string) => [...buyerCatalogKeys.all, 'product', handle] as const,
};

/** Build the catalog query string (cursor + optional search). */
function catalogPath(cursor: string | null, search: string): string {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  if (search.trim().length > 0) params.set('search', search.trim());
  const qs = params.toString();
  return `/buyer/catalog${qs ? `?${qs}` : ''}`;
}

/**
 * Infinite buyer catalog. Cursor-based pagination via `pageInfo.endCursor`. 5m
 * staleTime — catalog/pricing changes are rare and the API already caches
 * aggressively (with stampede protection). The Clerk token is attached by
 * {@link buyerFetch}; the merchant tenant is resolved server-side from the
 * App-Proxy cookie.
 */
export function useBuyerCatalog(
  search = '',
): UseInfiniteQueryResult<InfiniteData<CatalogPage>, Error> {
  return useInfiniteQuery({
    queryKey: buyerCatalogKeys.list(search),
    staleTime: 300_000,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      buyerFetch<CatalogPage>(catalogPath(pageParam, search), { signal }),
    getNextPageParam: (lastPage) =>
      lastPage.pageInfo.hasNextPage ? lastPage.pageInfo.endCursor : undefined,
  });
}

/**
 * A single tier-priced product by its Shopify handle (`GET /buyer/catalog/:handle`),
 * powering the product-detail page. Disabled until a handle is present; shares the
 * catalog's 5m staleTime since the API caches product detail the same way.
 */
export function useBuyerProduct(handle: string | null): UseQueryResult<CatalogProduct, Error> {
  return useQuery({
    queryKey: buyerCatalogKeys.product(handle ?? ''),
    enabled: handle !== null && handle.length > 0,
    staleTime: 300_000,
    queryFn: ({ signal }) =>
      buyerFetch<CatalogProduct>(`/buyer/catalog/${encodeURIComponent(handle ?? '')}`, { signal }),
  });
}
