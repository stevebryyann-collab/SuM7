import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  type OnModuleInit,
} from "@nestjs/common";
import { Redis } from "ioredis";
import type CircuitBreaker from "opossum";
import { CircuitBreakerFactory } from "../common/circuit-breaker/circuit-breaker.factory";
import { EncryptionService } from "../crypto/encryption.service";
import { REDIS_CACHE } from "../redis/redis.module";
import type {
  ListProductsParams,
  ShopifyDraftOrder,
  ShopifyDraftOrderInput,
  ShopifyOrder,
  ShopifyProduct,
} from "./shopify.types";

// Keep in lockstep with shopify.app.toml `api_version`. Bumped off the stale
// 2024-07 (past Shopify's ~12-month support window). Retest all webhook topics
// against this version before release.
const API_VERSION = "2025-10";
const MAX_RETRIES = 3;
const RATE_LIMIT_THRESHOLD = 0.8;
const THROTTLE_FLAG_TTL_MS = 2_000;
const THROTTLE_WAIT_MS = 1_000;
const BULK_POLL_INTERVAL_MS = 2_000;
const BULK_POLL_MAX_ATTEMPTS = 150; // ~5 minutes at 2s

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

interface ShopifyRequest {
  domain: string;
  /** Decrypted access token. NEVER logged. */
  token: string;
  method: HttpMethod;
  /** Path relative to `/admin/api/{version}`, e.g. `/orders/123.json`. */
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

/** Only the fields of the HTTP response the retry/rate-limit logic needs. */
interface RawResult {
  status: number;
  callLimit: string | null;
  retryAfter: string | null;
  link: string | null;
  text: string;
}

/**
 * Thrown by the breaker action for transient failures (5xx / network), so they
 * count toward the breaker's error rate. 429s and 4xx do NOT throw here — they
 * are returned and handled by the retry loop so rate limits never trip the
 * breaker.
 */
class ShopifyTransientError extends Error {}

interface BulkOperationStatus {
  id: string;
  status: string;
  errorCode: string | null;
  objectCount: string | null;
  url: string | null;
}

/**
 * All outbound Shopify Admin API access. Every call flows through a single
 * shared circuit breaker (10s timeout) and a retry layer that honours Shopify's
 * leaky-bucket rate limit:
 *   - reads `X-Shopify-Shop-Api-Call-Limit`; when usage > 80% it sets a short
 *     Redis throttle flag for the shop so concurrent callers back off;
 *   - on 429 it waits `Retry-After` (+jitter) and retries up to 3 times;
 *   - on 5xx/network it retries with exponential backoff (1s/2s/4s +jitter).
 * The decrypted access token is held only in locals and is never logged.
 */
@Injectable()
export class ShopifyApiService implements OnModuleInit {
  private readonly logger = new Logger(ShopifyApiService.name);
  private breaker!: CircuitBreaker<[ShopifyRequest], RawResult>;

  constructor(
    private readonly breakerFactory: CircuitBreakerFactory,
    private readonly encryption: EncryptionService,
    @Inject(REDIS_CACHE) private readonly cache: Redis,
  ) {}

  onModuleInit(): void {
    this.breaker = this.breakerFactory.create<[ShopifyRequest], RawResult>(
      "shopify",
      (req: ShopifyRequest) => this.doRequest(req),
      { timeout: 10_000 },
    );
  }

  // ── Public API ────────────────────────────────────────────────────────

  async getOrder(
    domain: string,
    encryptedToken: string,
    orderId: string,
  ): Promise<ShopifyOrder> {
    const token = this.encryption.decrypt(encryptedToken);
    const { order } = await this.request<{ order: ShopifyOrder }>({
      domain,
      token,
      method: "GET",
      path: `/orders/${encodeURIComponent(orderId)}.json`,
    });
    return order;
  }

  async getProduct(
    domain: string,
    encryptedToken: string,
    productId: string,
  ): Promise<ShopifyProduct> {
    const token = this.encryption.decrypt(encryptedToken);
    const { product } = await this.request<{ product: ShopifyProduct }>({
      domain,
      token,
      method: "GET",
      path: `/products/${encodeURIComponent(productId)}.json`,
    });
    return product;
  }

  /**
   * Streams every page of products, following Shopify's `Link: rel="next"`
   * cursor. Yields one page (array) at a time so callers can process without
   * buffering the whole catalog.
   */
  async *listProducts(
    domain: string,
    encryptedToken: string,
    params: ListProductsParams = {},
  ): AsyncGenerator<ShopifyProduct[], void, void> {
    const token = this.encryption.decrypt(encryptedToken);
    const limit = params.limit ?? 250;

    let query: Record<string, string | number | undefined> = {
      limit,
      status: params.status,
      updated_at_min: params.updatedAtMin,
      ids: params.ids,
    };

    for (;;) {
      const result = await this.requestRaw({
        domain,
        token,
        method: "GET",
        path: "/products.json",
        query,
      });
      const { products } = this.parseJson<{ products: ShopifyProduct[] }>(
        result.text,
      );
      if (products.length > 0) {
        yield products;
      }
      const pageInfo = this.extractNextPageInfo(result.link);
      if (!pageInfo) {
        return;
      }
      // With page_info, Shopify forbids other filters except `limit`.
      query = { limit, page_info: pageInfo };
    }
  }

  async createDraftOrder(
    domain: string,
    encryptedToken: string,
    input: ShopifyDraftOrderInput,
  ): Promise<ShopifyDraftOrder> {
    const token = this.encryption.decrypt(encryptedToken);
    const { draft_order } = await this.request<{
      draft_order: ShopifyDraftOrder;
    }>({
      domain,
      token,
      method: "POST",
      path: "/draft_orders.json",
      body: { draft_order: input },
    });
    return draft_order;
  }

  async completeDraftOrder(
    domain: string,
    encryptedToken: string,
    draftOrderId: string,
  ): Promise<ShopifyOrder> {
    const token = this.encryption.decrypt(encryptedToken);
    const { draft_order } = await this.request<{
      draft_order: ShopifyDraftOrder;
    }>({
      domain,
      token,
      method: "PUT",
      path: `/draft_orders/${encodeURIComponent(draftOrderId)}/complete.json`,
    });
    if (draft_order.order_id === null) {
      throw new BadGatewayException({
        code: "SHOPIFY_DRAFT_NOT_COMPLETED",
        message: "Draft order completed without producing an order id",
      });
    }
    const { order } = await this.request<{ order: ShopifyOrder }>({
      domain,
      token,
      method: "GET",
      path: `/orders/${draft_order.order_id}.json`,
    });
    return order;
  }

  async deleteDraftOrder(
    domain: string,
    encryptedToken: string,
    draftOrderId: string,
  ): Promise<void> {
    const token = this.encryption.decrypt(encryptedToken);
    await this.request<unknown>({
      domain,
      token,
      method: "DELETE",
      path: `/draft_orders/${encodeURIComponent(draftOrderId)}.json`,
    });
  }

  /**
   * Triggers the Bulk Operations API for a GraphQL query, polls until the
   * operation completes, and returns the JSONL result URL (S3-backed). Throws
   * if the operation fails or is cancelled.
   */
  async bulkOperationQuery(
    domain: string,
    encryptedToken: string,
    graphqlQuery: string,
  ): Promise<string> {
    const token = this.encryption.decrypt(encryptedToken);
    const mutation = `mutation {
      bulkOperationRunQuery(query: """${graphqlQuery}""") {
        bulkOperation { id status }
        userErrors { field message }
      }
    }`;

    const start = await this.requestGraphql<{
      bulkOperationRunQuery: {
        bulkOperation: { id: string; status: string } | null;
        userErrors: Array<{ field: string[] | null; message: string }>;
      };
    }>(domain, token, mutation);

    const userErrors = start.bulkOperationRunQuery.userErrors;
    if (userErrors.length > 0) {
      throw new BadGatewayException({
        code: "SHOPIFY_BULK_REJECTED",
        message: userErrors.map((e) => e.message).join("; "),
      });
    }

    for (let attempt = 0; attempt < BULK_POLL_MAX_ATTEMPTS; attempt += 1) {
      await this.sleep(BULK_POLL_INTERVAL_MS);
      const poll = await this.requestGraphql<{
        currentBulkOperation: BulkOperationStatus | null;
      }>(
        domain,
        token,
        "query { currentBulkOperation { id status errorCode objectCount url } }",
      );
      const op = poll.currentBulkOperation;
      if (!op) {
        continue;
      }
      if (op.status === "COMPLETED") {
        if (!op.url) {
          throw new BadGatewayException({
            code: "SHOPIFY_BULK_NO_URL",
            message:
              "Bulk operation completed with no result URL (empty result set)",
          });
        }
        return op.url;
      }
      if (
        op.status === "FAILED" ||
        op.status === "CANCELED" ||
        op.status === "EXPIRED"
      ) {
        throw new BadGatewayException({
          code: "SHOPIFY_BULK_FAILED",
          message: `Bulk operation ${op.status}: ${op.errorCode ?? "unknown error"}`,
        });
      }
    }

    throw new ServiceUnavailableException({
      code: "SHOPIFY_BULK_TIMEOUT",
      message: "Bulk operation did not complete within the polling window",
    });
  }

  // ── Internals ─────────────────────────────────────────────────────────

  /** Typed JSON request with full retry + rate-limit handling. */
  private async request<T>(req: ShopifyRequest): Promise<T> {
    const result = await this.requestRaw(req);
    return this.parseJson<T>(result.text);
  }

  private async requestGraphql<T>(
    domain: string,
    token: string,
    query: string,
  ): Promise<T> {
    const result = await this.requestRaw({
      domain,
      token,
      method: "POST",
      path: "/graphql.json",
      body: { query },
    });
    const parsed = this.parseJson<{
      data: T;
      errors?: Array<{ message: string }>;
    }>(result.text);
    if (parsed.errors && parsed.errors.length > 0) {
      throw new BadGatewayException({
        code: "SHOPIFY_GRAPHQL_ERROR",
        message: parsed.errors.map((e) => e.message).join("; "),
      });
    }
    return parsed.data;
  }

  /** Drives the breaker + retry loop and returns the raw (text) result. */
  private async requestRaw(req: ShopifyRequest): Promise<RawResult> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      await this.waitIfThrottled(req.domain);

      let result: RawResult;
      try {
        result = await this.breaker.fire(req);
      } catch (error) {
        if (this.isBreakerOpen(error)) {
          throw new ServiceUnavailableException({
            code: "SHOPIFY_CIRCUIT_OPEN",
            message:
              "Shopify integration is temporarily unavailable (circuit open)",
          });
        }
        if (attempt < MAX_RETRIES) {
          await this.sleep(this.backoffMs(attempt));
          continue;
        }
        throw new BadGatewayException({
          code: "SHOPIFY_UNAVAILABLE",
          message: "Shopify request failed after retries",
        });
      }

      await this.recordRateLimit(req.domain, result.callLimit);

      if (result.status === 429) {
        if (attempt < MAX_RETRIES) {
          await this.sleep(this.retryAfterMs(result.retryAfter));
          continue;
        }
        throw new ServiceUnavailableException({
          code: "SHOPIFY_RATE_LIMITED",
          message: "Shopify rate limit exceeded after retries",
        });
      }

      if (result.status >= 400) {
        throw new BadGatewayException({
          code: "SHOPIFY_ERROR",
          message: `Shopify responded with HTTP ${result.status}`,
        });
      }

      return result;
    }

    // Loop always returns or throws above; this satisfies the type checker.
    throw new BadGatewayException({
      code: "SHOPIFY_UNAVAILABLE",
      message: "Shopify request failed",
    });
  }

  /** The breaker action: exactly one network round-trip. */
  private async doRequest(req: ShopifyRequest): Promise<RawResult> {
    const url = this.buildUrl(req);
    const headers: Record<string, string> = {
      "X-Shopify-Access-Token": req.token,
      Accept: "application/json",
    };
    if (req.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: req.method,
        headers,
        ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
      });
    } catch (error) {
      throw new ShopifyTransientError(
        `network error: ${(error as Error).message}`,
      );
    }

    const text = await response.text();
    if (response.status >= 500) {
      // Throwing makes the breaker count this as a failure.
      throw new ShopifyTransientError(`Shopify ${response.status}`);
    }

    return {
      status: response.status,
      callLimit: response.headers.get("X-Shopify-Shop-Api-Call-Limit"),
      retryAfter: response.headers.get("Retry-After"),
      link: response.headers.get("Link"),
      text,
    };
  }

  private buildUrl(req: ShopifyRequest): string {
    const base = `https://${req.domain}/admin/api/${API_VERSION}${req.path}`;
    if (!req.query) {
      return base;
    }
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query)) {
      if (value !== undefined && value !== "") {
        search.append(key, String(value));
      }
    }
    const qs = search.toString();
    return qs ? `${base}?${qs}` : base;
  }

  /** Parse "32/40" → set a short throttle flag when usage exceeds 80%. */
  private async recordRateLimit(
    domain: string,
    callLimit: string | null,
  ): Promise<void> {
    if (!callLimit) {
      return;
    }
    const [currentRaw, maxRaw] = callLimit.split("/");
    const current = Number(currentRaw);
    const max = Number(maxRaw);
    if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0) {
      return;
    }
    if (current / max >= RATE_LIMIT_THRESHOLD) {
      await this.cache.set(
        this.throttleKey(domain),
        "1",
        "PX",
        THROTTLE_FLAG_TTL_MS,
      );
    }
  }

  private async waitIfThrottled(domain: string): Promise<void> {
    const flagged = await this.cache.exists(this.throttleKey(domain));
    if (flagged === 1) {
      this.logger.debug(
        `Throttling Shopify calls for ${domain} (bucket near limit)`,
      );
      await this.sleep(THROTTLE_WAIT_MS);
    }
  }

  private throttleKey(domain: string): string {
    return `shopify:throttle:${domain}`;
  }

  private extractNextPageInfo(link: string | null): string | null {
    if (!link) {
      return null;
    }
    for (const part of link.split(",")) {
      const match = part.match(/<([^>]+)>;\s*rel="next"/);
      if (match && match[1]) {
        const pageInfo = new URL(match[1]).searchParams.get("page_info");
        if (pageInfo) {
          return pageInfo;
        }
      }
    }
    return null;
  }

  private isBreakerOpen(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "EOPENBREAKER"
    );
  }

  private backoffMs(attempt: number): number {
    return 2 ** attempt * 1_000 + Math.random() * 250;
  }

  private retryAfterMs(retryAfter: string | null): number {
    const seconds = retryAfter ? Number(retryAfter) : 1;
    const base =
      Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : 1_000;
    return base + Math.random() * 100;
  }

  private parseJson<T>(text: string): T {
    return JSON.parse(text) as T;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
