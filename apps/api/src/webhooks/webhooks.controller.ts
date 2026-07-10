import { Controller, HttpCode, Post, Req, UseGuards } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { MerchantContextService } from "../prisma/merchant-context.service";
import {
  WebhookHmacGuard,
  type ShopifyWebhookRequest,
} from "./webhook-hmac.guard";
import {
  JOB_BUYER_SYNC,
  JOB_CATALOG_SYNC,
  JOB_INVENTORY_SYNC,
  JOB_INVOICE_GENERATE,
  JOB_INVOICE_MARK_PAID,
  JOB_MERCHANT_CLEANUP,
  JOB_ORDER_SYNC,
  JOB_ORDER_FULFILLMENT_SYNC,
  QUEUE_BUYER,
  QUEUE_CATALOG,
  QUEUE_INVOICE,
  QUEUE_MERCHANT,
  QUEUE_ORDER,
} from "../queues/queue.module";

/** Acknowledgement returned for every accepted webhook. */
interface WebhookAck {
  received: true;
}

/** The minimal job payload — workers re-read the raw payload from the DB. */
interface WebhookJobData {
  webhookEventId: string;
  shopifyDomain: string;
  topic: string;
}

/**
 * Inbound Shopify webhook ingestion. The controller does the bare minimum on the
 * request path: verify (via {@link WebhookHmacGuard}), dedupe + durably record
 * the event, enqueue a BullMQ job, and 200. All real work happens in workers.
 *
 * Idempotency is enforced by the `(shopify_domain, shopify_event_id)` unique
 * constraint: a duplicate delivery is acknowledged without re-enqueuing.
 */
@Controller("webhooks")
@UseGuards(WebhookHmacGuard)
export class WebhooksController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantContext: MerchantContextService,
    @InjectQueue(QUEUE_INVOICE)
    private readonly invoiceQueue: Queue<WebhookJobData>,
    @InjectQueue(QUEUE_ORDER)
    private readonly orderQueue: Queue<WebhookJobData>,
    @InjectQueue(QUEUE_CATALOG)
    private readonly catalogQueue: Queue<WebhookJobData>,
    @InjectQueue(QUEUE_BUYER)
    private readonly buyerQueue: Queue<WebhookJobData>,
    @InjectQueue(QUEUE_MERCHANT)
    private readonly merchantQueue: Queue<WebhookJobData>,
  ) {}

  @Post("orders/created")
  @HttpCode(200)
  ordersCreated(@Req() req: ShopifyWebhookRequest): Promise<WebhookAck> {
    return this.ingest(
      req,
      "orders/create",
      this.invoiceQueue,
      JOB_INVOICE_GENERATE,
      1,
    );
  }

  @Post("orders/updated")
  @HttpCode(200)
  ordersUpdated(@Req() req: ShopifyWebhookRequest): Promise<WebhookAck> {
    return this.ingest(
      req,
      "orders/updated",
      this.orderQueue,
      JOB_ORDER_SYNC,
      5,
    );
  }

  @Post("orders/paid")
  @HttpCode(200)
  ordersPaid(@Req() req: ShopifyWebhookRequest): Promise<WebhookAck> {
    return this.ingest(
      req,
      "orders/paid",
      this.invoiceQueue,
      JOB_INVOICE_MARK_PAID,
      1,
    );
  }

  @Post("fulfillments/create")
  @HttpCode(200)
  fulfillmentsCreate(@Req() req: ShopifyWebhookRequest): Promise<WebhookAck> {
    return this.ingest(
      req,
      "fulfillments/create",
      this.orderQueue,
      JOB_ORDER_FULFILLMENT_SYNC,
      3,
    );
  }

  @Post("fulfillments/update")
  @HttpCode(200)
  fulfillmentsUpdate(@Req() req: ShopifyWebhookRequest): Promise<WebhookAck> {
    return this.ingest(
      req,
      "fulfillments/update",
      this.orderQueue,
      JOB_ORDER_FULFILLMENT_SYNC,
      3,
    );
  }

  @Post("products/created")
  @HttpCode(200)
  productsCreated(@Req() req: ShopifyWebhookRequest): Promise<WebhookAck> {
    return this.ingest(
      req,
      "products/create",
      this.catalogQueue,
      JOB_CATALOG_SYNC,
      10,
    );
  }

  @Post("products/updated")
  @HttpCode(200)
  productsUpdated(@Req() req: ShopifyWebhookRequest): Promise<WebhookAck> {
    return this.ingest(
      req,
      "products/update",
      this.catalogQueue,
      JOB_CATALOG_SYNC,
      10,
    );
  }

  @Post("products/deleted")
  @HttpCode(200)
  productsDeleted(@Req() req: ShopifyWebhookRequest): Promise<WebhookAck> {
    return this.ingest(
      req,
      "products/delete",
      this.catalogQueue,
      JOB_CATALOG_SYNC,
      10,
    );
  }

  @Post("customers/create")
  @HttpCode(200)
  customersCreate(@Req() req: ShopifyWebhookRequest): Promise<WebhookAck> {
    return this.ingest(
      req,
      "customers/create",
      this.buyerQueue,
      JOB_BUYER_SYNC,
      10,
    );
  }

  @Post("customers/updated")
  @HttpCode(200)
  customersUpdated(@Req() req: ShopifyWebhookRequest): Promise<WebhookAck> {
    // Same buyer-sync fulfillment as customers/create: fill missing company
    // details onto the matching platform buyer (identity stays Clerk-owned).
    return this.ingest(
      req,
      "customers/update",
      this.buyerQueue,
      JOB_BUYER_SYNC,
      10,
    );
  }

  @Post("inventory-levels/updated")
  @HttpCode(200)
  inventoryLevelsUpdated(
    @Req() req: ShopifyWebhookRequest,
  ): Promise<WebhookAck> {
    return this.ingest(
      req,
      "inventory_levels/update",
      this.catalogQueue,
      JOB_INVENTORY_SYNC,
      10,
    );
  }

  @Post("app/uninstalled")
  @HttpCode(200)
  appUninstalled(@Req() req: ShopifyWebhookRequest): Promise<WebhookAck> {
    return this.ingest(
      req,
      "app/uninstalled",
      this.merchantQueue,
      JOB_MERCHANT_CLEANUP,
      1,
    );
  }

  /**
   * Record the webhook event idempotently and enqueue its processing job. The
   * raw payload is persisted to the DB (not the job) so workers re-read it; the
   * job carries only ids.
   */
  private async ingest(
    req: ShopifyWebhookRequest,
    topic: string,
    queue: Queue<WebhookJobData>,
    jobName: string,
    priority: number,
  ): Promise<WebhookAck> {
    // The guard guarantees this is set before any handler runs.
    const ctx = req.shopifyWebhook;
    if (!ctx) {
      return { received: true };
    }

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

    let webhookEventId: string;
    try {
      const event = await this.merchantContext.runAsSystem(() =>
        this.prisma.webhookEvent.create({
          data: {
            shopifyDomain: ctx.shopifyDomain,
            topic,
            shopifyEventId,
            shopifyCreatedAt,
            payloadJson,
            status: "pending",
          },
          select: { id: true },
        }),
      );
      webhookEventId = event.id;
    } catch (error) {
      // Duplicate delivery (same domain + event id): acknowledge, do not re-enqueue.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return { received: true };
      }
      throw error;
    }

    await queue.add(
      jobName,
      { webhookEventId, shopifyDomain: ctx.shopifyDomain, topic },
      { priority },
    );
    return { received: true };
  }
}
