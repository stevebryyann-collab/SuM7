'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { buyerFetch } from '@/lib/api/buyer';
import type { BuyerMe } from '@/types/api';

export const buyerAccountKeys = {
  all: ['buyer-account'] as const,
  me: () => [...buyerAccountKeys.all, 'me'] as const,
};

/**
 * The approved buyer's own relationship snapshot (tier, terms, credit, BNPL
 * availability). Backs the catalog welcome bar and the Review-Order credit + BNPL
 * sections. The Clerk token + merchant context are attached by {@link buyerFetch}.
 */
export function useBuyerMe(): UseQueryResult<BuyerMe, Error> {
  return useQuery({
    queryKey: buyerAccountKeys.me(),
    queryFn: ({ signal }) => buyerFetch<BuyerMe>('/buyer/me', { signal }),
    staleTime: 60_000,
  });
}
