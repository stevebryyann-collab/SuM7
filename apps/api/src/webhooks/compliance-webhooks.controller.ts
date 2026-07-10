import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
  type RawBodyRequest,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { Prisma } from "@prisma/client";
import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../prisma/prisma.service";
import { MerchantContextService } from "../prisma/merchant-context.service";
import {
  JOB_GDPR_CUSTOMER_REDACT,
  JOB_GDPR_DATA_REQUEST,
  JOB_MERCHANT_PURGE_DATA,
  QUEUE_BUYER,
  QUEUE_MERCHANT,
} from "../queues/queue.module";
import type {
  MerchantPurgeJobData,
  WebhookJobData,
} from "../workers/worker-helpers";

/** Acknowledgement returned for every accepted compliance webhook. */
interface WebhookAck {
  received: true;
}

/**
 * Shopify's THREE mandatory privacy/compliance webhooks:
 *   - customers/data_request
 *   - customers/redact
 *   - shop/redact
 *
 * These are verified INLINE (not via {@link WebhookHmacGuard}): that guard's
 * third check requires an *active* merchant, but `shop/redact` is delivered 48h
 * after uninstall and `customers/redact` can arrive post-uninstall, so the shop
 * may be inactive or already gone. We must still respond 200 to a validly-signed
 * request even when we hold no data for the shop.
 *
 * HMAC (base64 HMAC-SHA256 of the RAW body keyed by SHOPIFY_CLIENT_SECRET, in
 * constant time) is the only gate. Routes live under `/webhooks/*`, so the raw
 * body is preserved (main.ts) and the rate-limit guard is skipped.
 *
 * Two ways to register these with Shopify, both supported here:
 *   - `compliance_topics` in shopify.app.toml points at the SINGLE dispatcher
 *     URL `POST /webhooks/compliance` — Shopify sends all three topics there and
 *     names the topic in the `X-Shopify-Topic` header (see {@link dispatch}).
 *   - Partner-Dashboard per-topic config can instead point at the three explicit
 *     routes below. Both paths converge on the same verify→record→enqueue logic.
 */
@Controller("webhooks/compliance")
export class ComplianceWebhooksController {
  /** Shopify's mandatory compliance topics → their `X-Shopify-Topic` values. */
  private static readonly TOPIC_DATA_REQUEST = "customers/data_request";
  private static readonly TOPIC_CUSTOMER_REDACT = "customers/redact";
  private static readonly TOPIC_SHOP_REDACT = "shop/redact";

  constructor(
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
    private readonly merchantContext: MerchantContextService,
    @InjectQueue(QUEUE_BUYER)
    private readonly buyerQueue: Queue<WebhookJobData>,
    @InjectQueue(QUEUE_MERCHANT)
    private readonly merchantQueue: Queue<MerchantPurgeJobData>,
  ) {}

  /**
   * Unified compliance dispatcher — the URL declared under `compliance_topics`
   * in shopify.app.toml. Shopify delivers all three mandatory topics here and
   * identifies which via `X-Shopify-Topic`. We route to the same per-topic
   * fulfillment the explicit routes use. An unknown/absent topic is a 400 (a
   * validly-signed request for a topic we do not handle is a configuration bug,
   * not a silent success).
   */
  @Post()
  @HttpCode(200)
  async dispatch(
    @Req() req: RawBodyRequest<Request>,
    @Headers("x-shopify-topic") topicHeader: string | undefined,
  ): Promise<WebhookAck> {
    const topic = (topicHeader ?? "").trim();
    switch (topic) {
      case ComplianceWebhooksController.TOPIC_DATA_REQUEST:
        return this.handleDataRequest(req);
      case ComplianceWebhooksController.TOPIC_CUSTOMER_REDACT:
        return this.handleCustomerRedact(req);
      case ComplianceWebhooksController.TOPIC_SHOP_REDACT:
        return this.handleShopRedact(req);
      default:
        throw new BadRequestException({
          code: "UNKNOWN_COMPLIANCE_TOPIC",
          message: `Unsupported compliance topic: ${topic || "(none)"}`,
        });
    }
  }

  @Post("customers/data-request")
  @HttpCode(200)
  customersDataRequest(
    @Req() req: RawBodyRequest<Request>,
  ): Promise<WebhookAck> {
    return this.handleDataRequest(req);
  }

  @Post("customers/redact")
  @HttpCode(200)
  customersRedact(@Req() req: RawBodyRequest<Request>): Promise<WebhookAck> {
    return this.handleCustomerRedact(req);
  }

  @Post("shop/redact")
  @HttpCode(200)
  shopRedact(@Req() req: RawBodyRequest<Request>): Promise<WebhookAck> {
    return this.handleShopRedact(req);
  }

  /** customers/data_request: verify + record, then enqueue merchant-fulfilled export. */
  private async handleDataRequest(
    req: RawBodyRequest<Request>,
  ): Promise<WebhookAck> {
    const recorded = await this.verifyAndRecord(
      req,
      ComplianceWebhooksController.TOPIC_DATA_REQUEST,
    );
    if (recorded) {
      await this.buyerQueue.add(
        JOB_GDPR_DATA_REQUEST,
        {
          webhookEventId: recorded.webhookEventId,
          shopifyDomain: recorded.shopifyDomain,
          topic: ComplianceWebhooksController.TOPIC_DATA_REQUEST,
        },
        { priority: 5 },
      );
    }
    return { received: true };
  }

  /** customers/redact: verify + record, then enqueue cross-merchant-aware redaction. */
  private async handleCustomerRedact(
    req: RawBodyRequest<Request>,
  ): Promise<WebhookAck> {
    const recorded = await this.verifyAndRecord(
      req,
      ComplianceWebhooksController.TOPIC_CUSTOMER_REDACT,
    );
    if (recorded) {
      await this.buyerQueue.add(
        JOB_GDPR_CUSTOMER_REDACT,
        {
          webhookEventId: recorded.webhookEventId,
          shopifyDomain: recorded.shopifyDomain,
          topic: ComplianceWebhooksController.TOPIC_CUSTOMER_REDACT,
        },
        { priority: 2 },
      );
    }
    return { received: true };
  }

  /** shop/redact: verify + record, then enqueue the shop-wide purge. */
  private async handleShopRedact(
    req: RawBodyRequest<Request>,
  ): Promise<WebhookAck> {
    const recorded = await this.verifyAndRecord(
      req,
      ComplianceWebhooksController.TOPIC_SHOP_REDACT,
    );
    if (recorded) {
      // Reuse the shop-wide purge (buyers anonymized where sole-relationship,
      // old webhook events deleted, financial records retained). Resolve the
      // merchant even if already deactivated by app/uninstalled.
      const merchant = await this.merchantContext.runAsSystem(() =>
        this.prisma.merchant.findFirst({
          where: { shopifyDomain: recorded.shopifyDomain },
          select: { id: true },
        }),
      );
      if (merchant) {
        await this.merchantQueue.add(
          JOB_MERCHANT_PURGE_DATA,
          { merchantId: merchant.id },
          { priority: 1 },
        );
      }
    }
    return { received: true };
  }

  /**
   * Verify the HMAC, then idempotently record the event. Returns the ids needed
   * to enqueue fulfillment, or null when this is a duplicate delivery (already
   * recorded) — in which case the caller must NOT re-enqueue.
   */
  private async verifyAndRecord(
    req: RawBodyRequest<Request>,
    topic: string,
  ): Promise<{ webhookEventId: string; shopifyDomain: string } | null> {
    const raw = req.rawBody;
    if (!raw) {
      throw new UnauthorizedException({
        code: "MISSING_BODY",
        message: "Raw body unavailable",
      });
    }
    const provided = req.headers["x-shopify-hmac-sha256"];
    if (typeof provided !== "string" || provided.length === 0) {
      throw new UnauthorizedException({
        code: "MISSING_HMAC",
        message: "Missing HMAC header",
      });
    }
    const expected = createHmac(
      "sha256",
      this.config.get("SHOPIFY_CLIENT_SECRET"),
    )
      .update(raw)
      .digest("base64");
    const expectedBuf = Buffer.from(expected);
    const providedBuf = Buffer.from(provided);
    if (
      expectedBuf.length !== providedBuf.length ||
      !timingSafeEqual(expectedBuf, providedBuf)
    ) {
      throw new UnauthorizedException({
        code: "INVALID_HMAC",
        message: "HMAC verification failed",
      });
    }

    const domainHeader = req.headers["x-shopify-shop-domain"];
    const shopifyDomain = typeof domainHeader === "string" ? domainHeader : "";
    const eventIdHeader = req.headers["x-shopify-webhook-id"];
    const shopifyEventId =
      typeof eventIdHeader === "string" ? eventIdHeader : "";
    const createdAtHeader = req.headers["x-shopify-webhook-created-at"];
    const shopifyCreatedAt =
      typeof createdAtHeader === "string" &&
      !Number.isNaN(Date.parse(createdAtHeader))
        ? new Date(createdAtHeader)
        : null;
    const payloadJson = (req.body ?? {}) as Prisma.InputJsonValue;

    try {
      const event = await this.merchantContext.runAsSystem(() =>
        this.prisma.webhookEvent.create({
          data: {
            shopifyDomain,
            topic,
            shopifyEventId,
            shopifyCreatedAt,
            payloadJson,
            status: "pending",
          },
          select: { id: true },
        }),
      );
      return { webhookEventId: event.id, shopifyDomain };
    } catch (error) {
      // Duplicate delivery (same domain + event id): acknowledge without re-enqueuing.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return null;
      }
      throw error;
    }
  }
}
