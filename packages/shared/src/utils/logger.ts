/**
 * Structured logging via Pino. PII is masked at emit time so secrets never
 * reach stdout, log shippers, or Grafana. A correlation id is bound to every
 * line from AsyncLocalStorage so a single request can be traced end-to-end.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { pino, type Logger, type LoggerOptions } from 'pino';

/** Per-request context propagated through async boundaries. */
export interface CorrelationContext {
  correlationId: string;
}

/**
 * Shared correlation store. The API's correlation middleware enters this store
 * at the start of each request; the logger reads it via a Pino mixin.
 */
export const correlationStorage = new AsyncLocalStorage<CorrelationContext>();

/** Run `fn` with a bound correlation id available to all nested loggers. */
export function runWithCorrelationId<T>(correlationId: string, fn: () => T): T {
  return correlationStorage.run({ correlationId }, fn);
}

/** Current correlation id, if any request context is active. */
export function getCorrelationId(): string | undefined {
  return correlationStorage.getStore()?.correlationId;
}

const MASK = '[REDACTED]';

/** Exact field names always masked regardless of nesting depth. */
const EXPLICIT_SENSITIVE_KEYS = new Set<string>([
  'password',
  'passwordhash',
  'taxid',
  'phone',
  'accesstoken',
  'refreshtoken',
  'shopifyaccesstoken',
  'creditcardnumber',
  'cvv',
  'mfasecret',
]);

/** Any key matching this pattern is masked (token/secret/key/auth/credential). */
const SENSITIVE_KEY_PATTERN = /token|secret|key|auth|credential/i;

const MAX_MASK_DEPTH = 8;

function isSensitiveKey(key: string): boolean {
  return EXPLICIT_SENSITIVE_KEYS.has(key.toLowerCase()) || SENSITIVE_KEY_PATTERN.test(key);
}

/**
 * Recursively clone-and-mask an object. Cycles are guarded with a WeakSet and
 * depth is capped to bound the cost of logging large payloads.
 */
function maskDeep(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (depth > MAX_MASK_DEPTH) return '[TRUNCATED]';
  if (value === null || typeof value !== 'object') return value;

  if (seen.has(value as object)) return '[CIRCULAR]';
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => maskDeep(item, depth + 1, seen));
  }

  // Preserve Error objects' shape but mask any sensitive own-enumerable props.
  const source = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    if (isSensitiveKey(key)) {
      output[key] = MASK;
    } else {
      output[key] = maskDeep(source[key], depth + 1, seen);
    }
  }
  return output;
}

export interface CreateLoggerOptions {
  name: string;
  level?: string;
  /** When true, use the pretty transport (development only). */
  pretty?: boolean;
}

/**
 * Build a configured Pino logger. In production this emits compact JSON; in
 * development it uses `pino-pretty` if available.
 */
export function createLogger(options: CreateLoggerOptions): Logger {
  const { name, level = process.env.LOG_LEVEL ?? 'info', pretty = false } = options;

  const base: LoggerOptions = {
    name,
    level,
    // Mask the merged log object on every line.
    formatters: {
      log(object: Record<string, unknown>): Record<string, unknown> {
        return maskDeep(object, 0, new WeakSet()) as Record<string, unknown>;
      },
    },
    // Bind the active correlation id to every line.
    mixin(): Record<string, unknown> {
      const correlationId = getCorrelationId();
      return correlationId ? { correlationId } : {};
    },
    // Belt-and-suspenders: Pino's native redaction for hot top-level paths.
    redact: {
      paths: [
        'password',
        'passwordHash',
        'taxId',
        'phone',
        'accessToken',
        'refreshToken',
        'shopifyAccessToken',
        'creditCardNumber',
        'cvv',
        '*.password',
        '*.passwordHash',
        '*.accessToken',
        '*.refreshToken',
        '*.shopifyAccessToken',
        'req.headers.authorization',
        'req.headers.cookie',
      ],
      censor: MASK,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (pretty) {
    return pino({
      ...base,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
      },
    });
  }

  return pino(base);
}
