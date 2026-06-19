'use client';

import { getSession } from 'next-auth/react';
import { apiRequest, type ApiRequestOptions } from './core';
import { isDemoEnabled, isDemoMerchantId } from '@/lib/dev/demo';

/**
 * API client for merchant-admin routes. Always attaches the NextAuth Bearer
 * token (stored under `session.accessToken` by the `[...nextauth]` callbacks).
 * NEVER used for buyer routes (see {@link buyerFetch}) — the two auth systems
 * are kept strictly separate per the architecture rules.
 *
 * DEV ONLY: when the active session is the demo merchant (see {@link file://../dev/demo.ts}),
 * the request is served from in-app fixtures instead of the network, so the
 * merchant admin works with no backend running. The mock module is loaded
 * lazily so it never enters the production bundle.
 */
export async function merchantFetch<T>(
  path: string,
  options: Omit<ApiRequestOptions, 'token'> = {},
): Promise<T> {
  const session = await getSession();

  if (isDemoEnabled() && isDemoMerchantId(session?.merchantId)) {
    const { mockMerchantRequest } = await import('@/lib/dev/mock-api');
    return mockMerchantRequest<T>(path, options);
  }

  const token = session?.accessToken ?? null;
  return apiRequest<T>(path, { ...options, token });
}
