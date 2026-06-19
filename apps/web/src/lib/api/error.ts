import type { ApiError, ApiFieldError } from '@b2b/shared/types';

/**
 * Thrown by every API client call on a non-2xx response. Carries the parsed
 * {@link ApiError} envelope so UI layers can branch on `code` (snake_case
 * machine codes from the API) and surface field-level validation errors.
 */
export class ApiClientError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly fieldErrors: ApiFieldError[];
  readonly correlationId?: string;

  constructor(payload: ApiError) {
    super(payload.message);
    this.name = 'ApiClientError';
    this.statusCode = payload.statusCode;
    this.code = payload.code;
    this.fieldErrors = payload.errors ?? [];
    this.correlationId = payload.correlationId;
  }

  /** True when the session is invalid/expired and the caller should re-auth. */
  get isUnauthorized(): boolean {
    return this.statusCode === 401;
  }

  /** True when the buyer is authenticated but not approved by the merchant. */
  get isForbidden(): boolean {
    return this.statusCode === 403;
  }
}

/** Coerce an unknown error/body into a stable ApiError envelope. */
export function toApiError(status: number, body: unknown): ApiError {
  if (
    body &&
    typeof body === 'object' &&
    'code' in body &&
    'message' in body &&
    typeof (body as ApiError).message === 'string'
  ) {
    const api = body as ApiError;
    return {
      statusCode: api.statusCode ?? status,
      code: api.code,
      message: api.message,
      errors: api.errors,
      correlationId: api.correlationId,
    };
  }
  return {
    statusCode: status,
    code: 'unexpected_error',
    message: status === 0 ? 'Network request failed' : `Request failed (${status})`,
  };
}
