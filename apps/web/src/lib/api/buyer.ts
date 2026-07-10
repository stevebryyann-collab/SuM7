'use client';

import { apiRequest, type ApiRequestOptions } from './core';
import { REP_SESSION_TOKEN_KEY } from '@/lib/rep-session';

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
 * Read the signed merchant-context token from the `__merchant_ctx` cookie
 * (minted by the App-Proxy edge middleware). The cross-origin API cannot read
 * web-origin cookies, so we forward it explicitly as a header. Returns null
 * during SSR (no `document`) — buyerFetch is only invoked from client queries.
 */
function merchantContextToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)__merchant_ctx=([^;]+)/);
  return match && match[1] ? decodeURIComponent(match[1]) : null;
}

/**
 * When a sales rep is placing an order on a buyer's behalf, the rep portal stores
 * the impersonation token in sessionStorage. We forward it so the API's
 * SalesRepSessionGuard resolves the BUYER principal — the rep sees exactly what
 * the buyer would. Absent for ordinary buyer sessions.
 */
function repSessionToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(REP_SESSION_TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * API client for buyer-portal routes. Attaches the Clerk Bearer token AND the
 * signed `X-Merchant-Context` header, from which the API resolves the buyer's
 * merchant tenant server-side (replacing the broken cross-domain cookie). NEVER
 * used for merchant routes.
 */
export async function buyerFetch<T>(
  path: string,
  options: Omit<ApiRequestOptions, 'token'> = {},
): Promise<T> {
  const token = await buyerToken();
  const ctx = merchantContextToken();
  const rep = repSessionToken();
  const headers: Record<string, string> = { ...options.headers };
  if (ctx) headers['X-Merchant-Context'] = ctx;
  if (rep) headers['X-Sales-Rep-Session'] = rep;
  return apiRequest<T>(path, { ...options, token, headers });
}
