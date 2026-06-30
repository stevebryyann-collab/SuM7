'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { buyerFetch } from '@/lib/api/buyer';

/** A buyer's reorder reminder (buyer portal). Mirrors the API's StandingOrderDto. */
export interface StandingOrder {
  id: string;
  name: string;
  frequencyDays: number;
  frequencyLabel: string;
  nextReminderAt: string;
  lastReminderAt: string | null;
  sourceOrderId: string | null;
  isActive: boolean;
}

export interface CreateStandingOrderInput {
  sourceOrderId?: string;
  name?: string;
  frequencyDays: 7 | 14 | 30;
}

export const standingOrderKeys = {
  all: ['standing-orders'] as const,
};

/** The buyer's active reorder reminders (`GET /buyer/standing-orders`). */
export function useStandingOrders(): UseQueryResult<StandingOrder[]> {
  return useQuery({
    queryKey: standingOrderKeys.all,
    queryFn: async ({ signal }) => {
      const res = await buyerFetch<{ standingOrders: StandingOrder[] }>('/buyer/standing-orders', { signal });
      return res.standingOrders;
    },
  });
}

/** Create a reorder reminder (`POST /buyer/standing-orders`). */
export function useCreateStandingOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateStandingOrderInput) =>
      buyerFetch<StandingOrder>('/buyer/standing-orders', { method: 'POST', body: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: standingOrderKeys.all }),
  });
}

/** Turn off a reorder reminder (`DELETE /buyer/standing-orders/:id`). Deactivates, never deletes. */
export function useDeactivateStandingOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      buyerFetch<{ deactivated: true }>(`/buyer/standing-orders/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: standingOrderKeys.all }),
  });
}
