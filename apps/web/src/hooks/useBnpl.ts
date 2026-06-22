'use client';

import { useMutation } from '@tanstack/react-query';
import { buyerFetch } from '@/lib/api/buyer';
import type { BnplEligibility } from '@/types/api';

/** Result of initiating a Resolve financing session. */
export interface BnplInitiateResult {
  redirectUrl: string;
  expiresAt: string;
}

interface BnplInitiateInput {
  orderId: string;
  /** Selected term length in days (must be one offered by the eligibility check). */
  selectedTerms: number;
  /** Reuse the order's idempotency key so a retried initiate is safe. */
  idempotencyKey: string;
}

/**
 * Check Resolve BNPL eligibility for an order amount (pre-placement). The endpoint
 * is mounted under `/api/v1` (unlike the bare `/buyer/*` routes), so the full path
 * is sent explicitly. Returns a normalized {@link BnplEligibility} (money as strings).
 */
export function useBnplEligibility() {
  return useMutation({
    mutationFn: ({ orderAmount }: { orderAmount: number }) =>
      buyerFetch<BnplEligibility>('/api/v1/buyer/bnpl/eligibility', {
        method: 'POST',
        body: { orderAmount },
      }),
  });
}

/**
 * Start a Resolve financing session for a placed order and return its hosted
 * redirect URL. The backend requires the order's invoice to exist (created async
 * ≤60s of placement); callers handle a `NO_INVOICE_FOR_ORDER` response gracefully.
 */
export function useBnplInitiate() {
  return useMutation({
    mutationFn: ({ orderId, selectedTerms, idempotencyKey }: BnplInitiateInput) =>
      buyerFetch<BnplInitiateResult>('/api/v1/buyer/bnpl/initiate', {
        method: 'POST',
        body: { orderId, selectedTerms },
        idempotencyKey,
      }),
  });
}
