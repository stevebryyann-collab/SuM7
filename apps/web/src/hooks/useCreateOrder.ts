'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { BulkOrderInput } from '@b2b/shared/schemas';
import { buyerFetch } from '@/lib/api/buyer';
import type { OrderCreatedResult } from '@/types/api';
import { orderKeys } from './useOrders';

/**
 * Place a server-priced bulk order (buyer portal). The same idempotency token is
 * sent both in the body (`idempotencyKey`) and the `Idempotency-Key` header; the
 * caller generates it once with `crypto.randomUUID()` so a retry never
 * double-creates an order. The buyer's merchant tenant is resolved server-side.
 */
export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BulkOrderInput) =>
      buyerFetch<OrderCreatedResult>('/buyer/orders', {
        method: 'POST',
        body: input,
        idempotencyKey: input.idempotencyKey,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: orderKeys.all });
    },
  });
}
