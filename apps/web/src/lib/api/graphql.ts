'use client';

import { GraphQLClient, type Variables } from 'graphql-request';
import { getSession } from 'next-auth/react';
import { GRAPHQL_ENDPOINT } from '../env';
import { ApiClientError } from './error';
import { isDemoEnabled, isDemoMerchantId } from '@/lib/dev/demo';

/**
 * Merchant dashboard GraphQL client. The API's GraphQL gateway is merchant-only
 * and authenticates the NextAuth Bearer token while building the request context
 * (no token ⇒ no execution). Tenancy is taken from the token server-side.
 *
 * The client is constructed per call with the current session token rather than
 * cached, so a token refresh between navigations is always reflected.
 */
export async function merchantGraphQL<TData, TVars extends Variables = Variables>(
  document: string,
  variables?: TVars,
): Promise<TData> {
  const session = await getSession();

  // DEV ONLY: serve the demo merchant's dashboard from in-app fixtures.
  if (isDemoEnabled() && isDemoMerchantId(session?.merchantId)) {
    const { mockMerchantGraphQL } = await import('@/lib/dev/mock-api');
    return mockMerchantGraphQL<TData>(document);
  }

  const token = session?.accessToken;

  const client = new GraphQLClient(GRAPHQL_ENDPOINT, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    // The gateway rejects text/plain (CSRF). graphql-request sends
    // application/json by default, which satisfies csrfPrevention.
    credentials: 'omit',
  });

  try {
    return await client.request<TData>(document, variables);
  } catch (error) {
    throw normalizeGraphQLError(error);
  }
}

/** Map a graphql-request error onto the app's {@link ApiClientError} shape. */
function normalizeGraphQLError(error: unknown): ApiClientError {
  const err = error as {
    response?: { status?: number; errors?: Array<{ message: string; extensions?: { code?: string } }> };
    message?: string;
  };
  const status = err.response?.status ?? 500;
  const first = err.response?.errors?.[0];
  return new ApiClientError({
    statusCode: status,
    code: first?.extensions?.code ?? 'graphql_error',
    message: first?.message ?? err.message ?? 'GraphQL request failed',
  });
}
