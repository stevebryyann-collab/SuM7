import { API_BASE_URL } from '../env';
import { ApiClientError, toApiError } from './error';

/** Options accepted by the low-level API request helper. */
export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** JSON-serializable body. Omitted for GET requests. */
  body?: unknown;
  /** Bearer token (NextAuth merchant JWT or Clerk buyer token). */
  token?: string | null;
  /** Required on POST/PATCH order mutations; ignored elsewhere. */
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** Extra headers (rarely needed). */
  headers?: Record<string, string>;
}

const JSON_CONTENT = 'application/json';

/**
 * The single fetch primitive every API client is built on. It:
 *   - prefixes {@link API_BASE_URL} (paths are passed bare, e.g. `/buyer/orders`),
 *   - sends/receives JSON, attaches the Bearer token when present,
 *   - parses the API's `{ code, message, errors }` envelope on failure and
 *     throws a typed {@link ApiClientError},
 *   - returns `undefined` for 204 No Content.
 *
 * It never sends credentials cookies cross-origin — auth is Bearer-token only,
 * which is what both the merchant-session and Clerk guards expect.
 */
export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { method = 'GET', body, token, idempotencyKey, signal, headers = {} } = options;

  const requestHeaders: Record<string, string> = {
    Accept: JSON_CONTENT,
    ...headers,
  };
  if (token) requestHeaders.Authorization = `Bearer ${token}`;
  if (idempotencyKey) requestHeaders['Idempotency-Key'] = idempotencyKey;
  if (body !== undefined) requestHeaders['Content-Type'] = JSON_CONTENT;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL.replace(/\/$/, '')}${path}`, {
      method,
      headers: requestHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
      // Bearer auth only — no ambient cookies on the API origin.
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch (cause) {
    // Network-level failure (DNS, offline, aborted). Surface as a 0-status error.
    if (signal?.aborted) throw cause;
    throw new ApiClientError(toApiError(0, null));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const parsed: unknown = text.length > 0 ? safeJsonParse(text) : null;

  if (!response.ok) {
    throw new ApiClientError(toApiError(response.status, parsed));
  }

  return parsed as T;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
