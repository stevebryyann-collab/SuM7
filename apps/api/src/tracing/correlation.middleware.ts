import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { trace } from '@opentelemetry/api';
import * as Sentry from '@sentry/node';
import { correlationStorage } from '@b2b/shared';

/**
 * Re-exported so other modules can read the active correlation context from a
 * single canonical store (defined in @b2b/shared, also consumed by the logger).
 */
export { correlationStorage as correlationStore } from '@b2b/shared';

const REQUEST_ID_HEADER = 'x-request-id';

/** Accept only a sane request-id from clients; otherwise mint our own. */
function sanitizeIncomingId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 128) return null;
  // Restrict to URL/header-safe characters to avoid log/response injection.
  return /^[A-Za-z0-9._-]+$/.test(trimmed) ? trimmed : null;
}

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = sanitizeIncomingId(req.headers[REQUEST_ID_HEADER]);
    const correlationId = incoming ?? randomUUID();

    res.setHeader('X-Request-Id', correlationId);

    // Annotate the active span and Sentry scope for cross-tool correlation.
    trace.getActiveSpan()?.setAttribute('app.correlation_id', correlationId);
    Sentry.getCurrentScope().setTag('correlation_id', correlationId);

    // Everything downstream (handlers, services, logger) runs inside this store.
    correlationStorage.run({ correlationId }, () => next());
  }
}
