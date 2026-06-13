import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { hashToken } from '@b2b/shared';
import { PrismaService } from '../../prisma/prisma.service';

const IDEMPOTENCY_HEADER = 'idempotency-key';
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const IN_PROGRESS = 0; // sentinel responseStatus for an unfinished request
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Deterministic request fingerprint: method + path + canonicalized body. */
function computeRequestHash(method: string, path: string, body: unknown): string {
  return hashToken(`${method}:${path}:${canonicalize(body)}`);
}

/** Stable JSON stringify with sorted object keys (arrays keep order). */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(record[k])}`).join(',')}}`;
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  // Round-trip to guarantee the value is JSON-serializable for the Json column.
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

/**
 * Enforces idempotency for unsafe (POST/PATCH) requests carrying an
 * `Idempotency-Key`. Semantics:
 *   - missing key            → pass through (idempotency is opt-in)
 *   - non-UUIDv4 key         → 400
 *   - first use              → reserve, process, cache the response (24h)
 *   - replay, same payload   → 200-class replay of the cached response
 *   - replay, in progress    → 409 REQUEST_IN_PROGRESS
 *   - replay, different body  → 422 IDEMPOTENCY_KEY_REUSE
 */
@Injectable()
export class IdempotencyMiddleware implements NestMiddleware {
  private readonly logger = new Logger(IdempotencyMiddleware.name);

  constructor(private readonly prisma: PrismaService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (req.method !== 'POST' && req.method !== 'PATCH') {
      next();
      return;
    }

    const rawKey = req.headers[IDEMPOTENCY_HEADER];
    const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    if (!key) {
      next();
      return;
    }

    if (!UUID_V4.test(key)) {
      res.status(400).json({
        statusCode: 400,
        code: 'IDEMPOTENCY_KEY_INVALID',
        message: 'Idempotency-Key must be a UUID v4',
      });
      return;
    }

    const requestHash = computeRequestHash(req.method, req.originalUrl, req.body);

    // Atomically reserve the key. A unique violation means it already exists.
    try {
      await this.prisma.idempotencyKey.create({
        data: {
          key,
          requestHash,
          responseStatus: IN_PROGRESS,
          responseBody: {},
          expiresAt: new Date(Date.now() + TTL_MS),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        await this.handleExisting(key, requestHash, res, next);
        return;
      }
      throw error;
    }

    // First use: capture the response body and finalize the cached record.
    this.attachResponseCapture(res, key);
    next();
  }

  private async handleExisting(
    key: string,
    requestHash: string,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const existing = await this.prisma.idempotencyKey.findUnique({ where: { key } });
    if (!existing) {
      // Lost a race and the row vanished; let the request proceed.
      next();
      return;
    }

    if (existing.requestHash !== requestHash) {
      res.status(422).json({
        statusCode: 422,
        code: 'IDEMPOTENCY_KEY_REUSE',
        message: 'Idempotency-Key was already used with a different request payload',
      });
      return;
    }

    if (existing.responseStatus === IN_PROGRESS) {
      res.setHeader('Retry-After', '2');
      res.status(409).json({
        statusCode: 409,
        code: 'REQUEST_IN_PROGRESS',
        message: 'A request with this Idempotency-Key is still being processed',
      });
      return;
    }

    // Completed previously: replay the cached response verbatim.
    res.status(existing.responseStatus).json(existing.responseBody);
  }

  private attachResponseCapture(res: Response, key: string): void {
    const originalJson = res.json.bind(res);
    let captured: unknown;
    res.json = (body: unknown): Response => {
      captured = body;
      return originalJson(body);
    };

    res.on('finish', () => {
      void this.finalize(key, res.statusCode, captured);
    });
  }

  private async finalize(key: string, statusCode: number, body: unknown): Promise<void> {
    try {
      if (statusCode >= 500) {
        // Server error: release the reservation so the client can retry.
        await this.prisma.idempotencyKey.deleteMany({ where: { key, responseStatus: IN_PROGRESS } });
        return;
      }
      await this.prisma.idempotencyKey.update({
        where: { key },
        data: { responseStatus: statusCode, responseBody: toJsonValue(body) },
      });
    } catch (error) {
      this.logger.error(
        `Failed to finalize idempotency key ${key}: ${(error as Error).message}`,
      );
    }
  }
}
