import { Injectable, Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import type { MerchantPurgeJobData } from "./worker-helpers";

const BCRYPT_COST = 12;
const RETENTION_DAYS = 90;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
/**
 * Minimum continuous-uninstall age before a purge may run. Set one day under the
 * 90-day schedule delay so scheduler jitter can't false-skip the normal case,
 * while any reinstall→re-uninstall permutation (where an OLD delayed job fires
 * after a MORE-RECENT uninstall) is still skipped until 89 days after the latest
 * uninstall — the fresh uninstall scheduled its own purge.
 */
const PURGE_MIN_UNINSTALL_MS = RETENTION_MS - 24 * 60 * 60 * 1000;

/**
 * GDPR data purge that runs 90 days after a merchant uninstall (scheduled by the
 * cleanup worker). NOT its own BullMQ consumer — invoked by the single merchant
 * worker, which dispatches by job name. Assumes a SYSTEM (bypass-RLS) context.
 *
 * Buyers whose ONLY relationship was with this merchant are anonymized; buyers
 * still trading with other merchants keep their PII. Old webhook events are
 * deleted, but orders and invoices are retained (7-year financial obligation).
 */
@Injectable()
export class MerchantPurgeService {
  private readonly logger = new Logger(MerchantPurgeService.name);

  constructor(private readonly prisma: PrismaService) {}

  async run(job: Job<MerchantPurgeJobData>): Promise<void> {
    const { merchantId } = job.data;

    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: {
        id: true,
        shopifyDomain: true,
        isActive: true,
        deletedAt: true,
      },
    });
    if (!merchant) {
      this.logger.warn(`Merchant ${merchantId} not found; nothing to purge`);
      return;
    }

    // Reinstall guard (App Store data-loss BLOCKER). This delayed job was
    // enqueued 90 days ago on app/uninstalled. If the merchant reinstalled since,
    // re-auth revived it (MerchantsService.upsert sets isActive:true, deletedAt:
    // null), so purging now would destroy a LIVE merchant's data. Only purge a
    // merchant that is still uninstalled AND has been continuously uninstalled
    // for ~90 days (guards the reinstall→re-uninstall case, where an older job
    // could otherwise fire against a more-recent, not-yet-elapsed uninstall).
    const uninstalledForMs = merchant.deletedAt
      ? Date.now() - merchant.deletedAt.getTime()
      : 0;
    if (
      merchant.isActive ||
      merchant.deletedAt === null ||
      uninstalledForMs < PURGE_MIN_UNINSTALL_MS
    ) {
      this.logger.log(
        `Merchant ${merchantId} not purge-eligible (reactivated or within retention window); skipping purge`,
      );
      return;
    }

    const relationships = await this.prisma.merchantBuyerRelationship.findMany({
      where: { merchantId },
      select: { buyerId: true },
    });

    let anonymized = 0;
    for (const { buyerId } of relationships) {
      const otherRelationships =
        await this.prisma.merchantBuyerRelationship.count({
          where: { buyerId, merchantId: { not: merchantId } },
        });
      if (otherRelationships > 0) {
        continue;
      }
      await this.anonymizeBuyer(buyerId);
      anonymized += 1;
    }

    const cutoff = new Date(Date.now() - RETENTION_MS);
    const deletedEvents = await this.prisma.webhookEvent.deleteMany({
      where: {
        shopifyDomain: merchant.shopifyDomain,
        createdAt: { lt: cutoff },
      },
    });

    await this.prisma.auditLog.create({
      data: {
        merchantId,
        entityType: "merchant",
        entityId: merchantId,
        action: "data_purged",
        actorType: "system",
        newValueJson: {
          buyersAnonymized: anonymized,
          webhookEventsDeleted: deletedEvents.count,
        },
      },
    });

    this.logger.log(
      `Purged merchant ${merchantId}: ${anonymized} buyer(s) anonymized, ${deletedEvents.count} webhook event(s) deleted`,
    );
  }

  private async anonymizeBuyer(buyerId: string): Promise<void> {
    const passwordHash = await bcrypt.hash(randomUUID(), BCRYPT_COST);
    await this.prisma.buyer.update({
      where: { id: buyerId },
      data: {
        anonymizedAt: new Date(),
        email: `erased+${randomUUID()}@redacted.invalid`,
        companyName: "ERASED",
        taxId: null,
        phone: null,
        addressJson: Prisma.DbNull,
        passwordHash,
        // Sever the Clerk identity link too (parity with BuyersService.eraseBuyer
        // and the GDPR worker): without this an "anonymized" buyer stays joined to
        // a live, re-identifiable Clerk user, defeating the purge.
        clerkUserId: null,
      },
    });
  }
}
