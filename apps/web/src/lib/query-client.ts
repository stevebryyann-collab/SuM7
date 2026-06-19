'use client';

import { QueryClient } from '@tanstack/react-query';
import { ApiClientError } from './api/error';

/**
 * Shared TanStack Query client factory. A single instance is created per browser
 * session (in Providers) and reused. Defaults reflect financial-app expectations:
 *   - Never retry 401/403/422 — those are deterministic auth/validation failures.
 *   - One retry on transient 5xx/network errors.
 *   - 60s default staleness; per-hook overrides tighten or loosen this.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          if (error instanceof ApiClientError) {
            // Auth, forbidden and validation errors are not transient.
            if ([400, 401, 403, 404, 409, 422].includes(error.statusCode)) return false;
          }
          return failureCount < 1;
        },
      },
      mutations: {
        retry: false,
      },
    },
  });
}
