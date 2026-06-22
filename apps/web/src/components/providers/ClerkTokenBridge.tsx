'use client';

import { useEffect } from 'react';
import { useAuth } from '@clerk/nextjs';
import { registerBuyerTokenGetter } from '@/lib/api/buyer';

/**
 * Bridges Clerk's `getToken()` (only callable inside a React component) to the
 * plain-async {@link buyerFetch} client. Mounted once inside the buyer-portal
 * ClerkProvider; re-registers on every Clerk auth state change so the token
 * getter always reflects the current session.
 */
export function ClerkTokenBridge(): null {
  const { getToken, isLoaded } = useAuth();

  useEffect(() => {
    if (!isLoaded) return;
    registerBuyerTokenGetter(() => getToken());
  }, [getToken, isLoaded]);

  return null;
}
