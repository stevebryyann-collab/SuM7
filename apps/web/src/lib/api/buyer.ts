'use client';

import { apiRequest, type ApiRequestOptions } from './core';

/**
 * Buyer auth is owned entirely by Clerk. The Clerk session token is only
 * obtainable from the `useAuth().getToken()` hook, which cannot be called
 * outside a React component. To keep {@link buyerFetch} a plain async function
 * (callable from TanStack Query `queryFn`s), a {@link ClerkTokenBridge}
 * component registers Clerk's `getToken` here on mount.
 */
type TokenGetter = () => Promise<string | null>;

let tokenGetter: TokenGetter | null = null;

/** Registered once by {@link ClerkTokenBridge}; replaced on every Clerk re-render. */
export function registerBuyerTokenGetter(getter: TokenGetter): void {
  tokenGetter = getter;
}

async function buyerToken(): Promise<string | null> {
  if (!tokenGetter) return null;
  return tokenGetter();
}

/**
 * API client for buyer-portal routes. Always attaches the Clerk Bearer token.
 * The buyer's merchant tenant is resolved server-side by the ClerkBuyerGuard
 * from the `__merchant_domain` App-Proxy cookie — never sent by the client.
 * NEVER used for merchant routes.
 */
export async function buyerFetch<T>(
  path: string,
  options: Omit<ApiRequestOptions, 'token'> = {},
): Promise<T> {
  const token = await buyerToken();
  return apiRequest<T>(path, { ...options, token });
}
