import { Injectable, Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import type { WebhookJobData } from "./worker-helpers";

/** Minimal shape of Shopify's compliance webhook payloads we read. */
interface ComplianceCustomerPayload {
  shop_domain?: string;
  customer?: { id?: number | string; email?: string | null } | null;
  data_request?: { id?: number | string } | null;
}

/**
 * Fulfillment for Shopify's two customer-scoped mandatory compliance webhooks,
 * delegated from {@link BuyerSyncWorker} (dispatch by job name on the buyer
 * queue). Runs inside the worker's SYSTEM (bypass-RLS) context.
 *
 * `shop/redact` is NOT handled here — it reuses the merchant-queue
 * {@link MerchantPurgeService} (a shop-wide purge), enqueued directly by the
 * compliance controller.
 *
 * Buyers are UNIFIED cross-merchant, so `customers/redact` cannot blindly scrub
 * a shared identity that is still trading with other merchants. Policy:
 *   - sole relationship (or none left)  → anonymize the global buyer record;
 *   - still related to other merchants  → retain the shared identity (a legally
 *     justified active-customer relationship elsewhere) and audit the deferral.
 *     Anonymization then happens when the last relationship is redacted/purged.
 */
@Injectable()
export class GdprComplianceService {
  private readonly logger = new Logger(GdprComplianceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * customers/data_request: record the inbound request against the merchant so
   * the store owner can fulfill it via the existing merchant GDPR export tooling
   * (Shopify requires the data be provided to the merchant, not to Shopify).
   */
  async recordDataRequest(job: Job<WebhookJobData>): Promise<void> {
    const event = await this.beginProcessing(job);
    if (!event) return;

    const payload = event.payloadJson as ComplianceCustomerPayload | null;
    const email = payload?.customer?.email ?? null;
    const merchant = await this.prisma.merchant.findFirst({
      where: { shopifyDomain: job.data.shopifyDomain },
      select: { id: true },
    });
    const buyer = email
      ? await this.prisma.buyer.findUnique({
          where: { email },
          select: { id: true },
        })
      : null;

    // audit_log.entity_id is a NOT-NULL uuid: anchor to the buyer when known,
    // else the merchant. If neither exists there is nothing to attribute, so we
    // only log — the request is still acknowledged 200 to Shopify.
    const entity =
      buyer !== null
        ? { entityType: "buyer", entityId: buyer.id }
        : merchant !== null
          ? { entityType: "merchant", entityId: merchant.id }
          : null;

    if (entity) {
      await this.prisma.auditLog.create({
        data: {
          merchantId: merchant?.id ?? null,
          entityType: entity.entityType,
          entityId: entity.entityId,
          action: "gdpr_data_request_received",
          actorType: "shopify_webhook",
          newValueJson: {
            shopDomain: job.data.shopifyDomain,
            customerEmail: email,
            dataRequestId: payload?.data_request?.id ?? null,
          },
        },
      });
    }

    await this.markProcessed(event.id);
    this.logger.log(
      `Recorded customers/data_request for ${email ?? "unknown"} @ ${job.data.shopifyDomain}`,
    );
  }

  /**
   * customers/redact: anonymize the buyer's PII where legally permitted, applying
   * the cross-merchant policy above. Financial records (orders/invoices) are
   * retained under the 7-year obligation, as Shopify allows.
   */
  async redactCustomer(job: Job<WebhookJobData>): Promise<void> {
    const event = await this.beginProcessing(job);
    if (!event) return;

    const payload = event.payloadJson as ComplianceCustomerPayload | null;
    const email = payload?.customer?.email ?? null;
    if (!email) {
      this.logger.warn(
        "customers/redact payload has no customer email; nothing to redact",
      );
      await this.markProcessed(event.id);
      return;
    }

    const buyer = await this.prisma.buyer.findUnique({
      where: { email },
      select: { id: true, anonymizedAt: true },
    });
    const merchant = await this.prisma.merchant.findFirst({
      where: { shopifyDomain: job.data.shopifyDomain },
      select: { id: true },
    });

    if (!buyer) {
      this.logger.debug(`No platform buyer for ${email}; redact is a no-op`);
      await this.markProcessed(event.id);
      return;
    }
    if (buyer.anonymizedAt) {
      this.logger.debug(
        `Buyer ${buyer.id} already anonymized; redact is idempotent no-op`,
      );
      await this.markProcessed(event.id);
      return;
    }

    // Documented unified-buyer policy: UNLINK the requesting merchant's
    // relationship, then anonymize the shared identity only once NO relationship
    // remains. Unlinking (not merely counting "other" merchants) is what makes
    // erasure eventually COMPLETE: each merchant's redact removes its own row, so
    // the LAST redact drops the count to zero and anonymizes. Merely counting
    // would strand any buyer that ever traded with two merchants — neither
    // merchant's row is ever removed, so the count never reaches zero. Delete +
    // count + scrub run in ONE Serializable transaction so two concurrent redacts
    // for the same buyer cannot both observe the other's row and both defer
    // (which would leave a relationship-less buyer un-anonymized forever).
    // Orders/invoices key on buyerId (onDelete: Restrict), NOT the relationship,
    // so financial history is retained under the 7-year obligation.
    const { unlinkedCount, remaining } = await this.prisma.$transaction(
      async (tx) => {
        const unlinked = merchant
          ? await tx.merchantBuyerRelationship.deleteMany({
              where: { buyerId: buyer.id, merchantId: merchant.id },
            })
          : { count: 0 };
        const left = await tx.merchantBuyerRelationship.count({
          where: { buyerId: buyer.id },
        });
        if (left === 0) {
          await this.anonymizeBuyer(tx, buyer.id);
        }
        return { unlinkedCount: unlinked.count, remaining: left };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (unlinkedCount > 0) {
      await this.prisma.auditLog.create({
        data: {
          merchantId: merchant?.id ?? null,
          entityType: "buyer",
          entityId: buyer.id,
          action: "gdpr_relationship_unlinked",
          actorType: "shopify_webhook",
          newValueJson: { shopDomain: job.data.shopifyDomain },
        },
      });
    }

    if (remaining > 0) {
      // A relationship still remains → an active wholesale relationship with
      // ANOTHER merchant is a lawful basis to retain the shared identity for now.
      await this.prisma.auditLog.create({
        data: {
          merchantId: merchant?.id ?? null,
          entityType: "buyer",
          entityId: buyer.id,
          action: "gdpr_redact_deferred_cross_merchant",
          actorType: "shopify_webhook",
          newValueJson: {
            shopDomain: job.data.shopifyDomain,
            remainingRelationships: remaining,
          },
        },
      });
      await this.markProcessed(event.id);
      this.logger.log(
        `customers/redact deferred for buyer ${buyer.id}: ${remaining} relationship(s) remain with other merchant(s)`,
      );
      return;
    }

    await this.prisma.auditLog.create({
      data: {
        merchantId: merchant?.id ?? null,
        entityType: "buyer",
        entityId: buyer.id,
        action: "gdpr_redacted",
        actorType: "shopify_webhook",
        newValueJson: { shopDomain: job.data.shopifyDomain },
      },
    });
    await this.markProcessed(event.id);
    this.logger.log(`customers/redact anonymized buyer ${buyer.id}`);
  }

  /**
   * Mirror of BuyersService/MerchantPurgeService anonymization (PII scrub). Takes
   * a transaction client so it can run atomically with the unlink + remaining
   * count that gates it.
   */
  private async anonymizeBuyer(
    tx: Prisma.TransactionClient,
    buyerId: string,
  ): Promise<void> {
    await tx.buyer.update({
      where: { id: buyerId },
      data: {
        anonymizedAt: new Date(),
        email: `erased+${randomUUID()}@redacted.invalid`,
        companyName: "ERASED",
        taxId: null,
        phone: null,
        addressJson: Prisma.DbNull,
        clerkUserId: null,
        // Match the canonical scrub in BuyersService.eraseBuyer: the legacy
        // buyer passwordHash (NOT-NULL column, unused now Clerk owns auth) must
        // be cleared too, else an "anonymized" buyer keeps a stale credential.
        passwordHash: "",
      },
    });
  }

  /**
   * Load the webhook event and mark it `processing`. Returns null when the event
   * row is missing (nothing to do) so callers can bail cleanly.
   */
  private async beginProcessing(
    job: Job<WebhookJobData>,
  ): Promise<{ id: string; payloadJson: Prisma.JsonValue } | null> {
    const event = await this.prisma.webhookEvent.findUnique({
      where: { id: job.data.webhookEventId },
      select: { id: true, payloadJson: true },
    });
    if (!event) {
      this.logger.warn(
        `Webhook event ${job.data.webhookEventId} not found; skipping`,
      );
      return null;
    }
    await this.prisma.webhookEvent.update({
      where: { id: event.id },
      data: {
        status: "processing",
        workerJobId: job.id ?? null,
        attemptCount: job.attemptsMade + 1,
      },
    });
    return event;
  }

  private async markProcessed(webhookEventId: string): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: { status: "processed", processedAt: new Date() },
    });
  }
}
