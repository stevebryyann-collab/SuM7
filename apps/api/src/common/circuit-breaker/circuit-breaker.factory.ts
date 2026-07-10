import { Injectable, Logger } from "@nestjs/common";
import CircuitBreaker from "opossum";
import * as Sentry from "@sentry/node";

/**
 * Per-service action timeouts (ms). The key is the breaker-name prefix before
 * any `:` suffix, so `shopify:rest` and `shopify:graphql` both resolve to the
 * Shopify timeout.
 */
const SERVICE_TIMEOUTS: Record<string, number> = {
  shopify: 10_000,
  paddle: 15_000,
  resolve: 10_000,
  resend: 5_000,
};

const DEFAULT_TIMEOUT = 10_000;

/** Shared breaker thresholds (identical across all outbound integrations). */
const VOLUME_THRESHOLD = 10;
const ERROR_THRESHOLD_PERCENTAGE = 50;
const RESET_TIMEOUT = 30_000;

export interface CreateBreakerOptions {
  /** Override the per-service timeout (ms). */
  timeout?: number;
  /**
   * Predicate that returns `true` for errors that must NOT count as a breaker
   * failure (e.g. an HTTP 429 is a rate-limit signal, not a service outage).
   */
  errorFilter?: (error: Error) => boolean;
}

/**
 * Creates and caches named opossum circuit breakers. One breaker is shared per
 * logical action (keyed by `name`) so its rolling stats and open/closed state
 * persist across calls. Breakers are also exposed via {@link getAll} for the
 * `/health/circuit-breakers` endpoint.
 *
 * On state transitions: `open` raises a Sentry alert + error log, `halfOpen`
 * and `close` are logged. The wrapped action is never given the decrypted
 * Shopify token here — callers pass only what their action closure needs.
 */
@Injectable()
export class CircuitBreakerFactory {
  private readonly logger = new Logger(CircuitBreakerFactory.name);
  private readonly breakers = new Map<string, CircuitBreaker>();

  create<TArgs extends unknown[], TReturn>(
    name: string,
    fn: (...args: TArgs) => Promise<TReturn>,
    options: CreateBreakerOptions = {},
  ): CircuitBreaker<TArgs, TReturn> {
    const cached = this.breakers.get(name);
    if (cached) {
      return cached as unknown as CircuitBreaker<TArgs, TReturn>;
    }

    const timeout = options.timeout ?? this.resolveTimeout(name);
    const breaker = new CircuitBreaker<TArgs, TReturn>(fn, {
      name,
      timeout,
      volumeThreshold: VOLUME_THRESHOLD,
      errorThresholdPercentage: ERROR_THRESHOLD_PERCENTAGE,
      resetTimeout: RESET_TIMEOUT,
      ...(options.errorFilter ? { errorFilter: options.errorFilter } : {}),
    });

    breaker.on("open", () => {
      this.logger.error(
        `[circuit-breaker:${name}] OPEN — failing fast for ${RESET_TIMEOUT}ms`,
      );
      Sentry.captureMessage(`Circuit breaker OPEN: ${name}`, {
        level: "error",
        tags: { component: "circuit-breaker", breaker: name },
        extra: {
          fires: breaker.stats.fires,
          failures: breaker.stats.failures,
          timeouts: breaker.stats.timeouts,
        },
      });
    });
    breaker.on("halfOpen", () => {
      this.logger.warn(
        `[circuit-breaker:${name}] HALF-OPEN — probing recovery`,
      );
    });
    breaker.on("close", () => {
      this.logger.log(`[circuit-breaker:${name}] CLOSED — service healthy`);
    });

    this.breakers.set(name, breaker as unknown as CircuitBreaker);
    return breaker;
  }

  /** A previously-created breaker, or undefined if `name` is unknown. */
  get(name: string): CircuitBreaker | undefined {
    return this.breakers.get(name);
  }

  /** Every registered breaker (for the health endpoint). */
  getAll(): CircuitBreaker[] {
    return Array.from(this.breakers.values());
  }

  private resolveTimeout(name: string): number {
    const prefix = name.split(":")[0] ?? name;
    return SERVICE_TIMEOUTS[prefix] ?? DEFAULT_TIMEOUT;
  }
}
