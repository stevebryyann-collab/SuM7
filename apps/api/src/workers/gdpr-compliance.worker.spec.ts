import type { Job } from "bullmq";
import { Prisma } from "@prisma/client";
import { GdprComplianceService } from "./gdpr-compliance.worker";
import type { PrismaService } from "../prisma/prisma.service";
import type { WebhookJobData } from "./worker-helpers";

/**
 * Fulfillment for Shopify's two customer-scoped compliance webhooks. Buyers are
 * UNIFIED cross-merchant, so these tests pin the redact POLICY precisely:
 *   - sole relationship  → the global buyer is anonymized (every PII field scrubbed);
 *   - shared identity    → redaction is DEFERRED + audited, PII retained (a
 *     legally-justified active-customer relationship exists elsewhere);
 *   - already-anonymized / unknown-buyer / no-email → idempotent no-ops.
 * Every branch must still mark the webhook event processed so it is never retried
 * forever. Prisma is mocked; the worker's SYSTEM (bypass-RLS) context is implicit.
 */

const EVENT_ID = "wh-event-1";
const SHOP = "acme.myshopify.com";
const BUYER_ID = "buyer-1";
const MERCHANT_ID = "merch-1";

interface Mocks {
  service: GdprComplianceService;
  webhookEventUpdate: jest.Mock;
  buyerUpdate: jest.Mock;
  auditCreate: jest.Mock;
  relationshipCount: jest.Mock;
  relationshipDelete: jest.Mock;
  buyerFindUnique: jest.Mock;
}

function setup(opts: {
  payload: unknown;
  event?: unknown; // undefined = present with payload; null = missing row
  buyer?: { id: string; anonymizedAt: Date | null } | null;
  merchant?: { id: string } | null;
  /** Relationships REMAINING after the requesting merchant is unlinked. */
  otherRelationships?: number;
  /** Rows removed by the unlink deleteMany (defaults to 1 when merchant known). */
  deletedCount?: number;
}): Mocks {
  const eventRow =
    opts.event === null
      ? null
      : { id: EVENT_ID, payloadJson: opts.payload as Prisma.JsonValue };

  const webhookEventUpdate = jest.fn().mockResolvedValue({});
  const buyerUpdate = jest.fn().mockResolvedValue({});
  const auditCreate = jest.fn().mockResolvedValue({});
  const relationshipCount = jest
    .fn()
    .mockResolvedValue(opts.otherRelationships ?? 0);
  const relationshipDelete = jest.fn().mockResolvedValue({
    count: opts.deletedCount ?? (opts.merchant === null ? 0 : 1),
  });
  const buyerFindUnique = jest
    .fn()
    .mockResolvedValue(opts.buyer === undefined ? null : opts.buyer);

  const prismaBase = {
    webhookEvent: {
      findUnique: jest.fn().mockResolvedValue(eventRow),
      update: webhookEventUpdate,
    },
    buyer: { findUnique: buyerFindUnique, update: buyerUpdate },
    merchant: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          opts.merchant === undefined ? { id: MERCHANT_ID } : opts.merchant,
        ),
    },
    merchantBuyerRelationship: {
      count: relationshipCount,
      deleteMany: relationshipDelete,
    },
    auditLog: { create: auditCreate },
  };
  // The real redact path deletes + counts + scrubs inside one Serializable
  // $transaction; the mock invokes the callback with a tx client that proxies to
  // the same relationship/buyer mocks.
  const prisma = {
    ...prismaBase,
    $transaction: (fn: (tx: unknown) => unknown) => fn(prismaBase),
  } as unknown as PrismaService;

  return {
    service: new GdprComplianceService(prisma),
    webhookEventUpdate,
    buyerUpdate,
    auditCreate,
    relationshipCount,
    relationshipDelete,
    buyerFindUnique,
  };
}

function job(data?: Partial<WebhookJobData>): Job<WebhookJobData> {
  return {
    id: "job-1",
    attemptsMade: 0,
    data: {
      webhookEventId: EVENT_ID,
      shopifyDomain: SHOP,
      topic: "t",
      ...data,
    },
  } as unknown as Job<WebhookJobData>;
}

function processedCall(update: jest.Mock): unknown {
  return update.mock.calls.find(
    ([arg]) =>
      (arg as { data?: { status?: string } })?.data?.status === "processed",
  );
}

describe("GdprComplianceService.redactCustomer", () => {
  it("anonymizes the buyer and scrubs EVERY PII field when the merchant is the sole relationship", async () => {
    const m = setup({
      payload: { customer: { email: "buyer@example.com" } },
      buyer: { id: BUYER_ID, anonymizedAt: null },
      otherRelationships: 0,
    });

    await m.service.redactCustomer(job());

    expect(m.buyerUpdate).toHaveBeenCalledTimes(1);
    const data = (
      m.buyerUpdate.mock.calls[0]![0] as { data: Record<string, unknown> }
    ).data;
    // No PII may survive: email replaced, company erased, tax/phone/address dropped,
    // Clerk link severed, and the anonymization timestamp set.
    expect(data.email).toMatch(/@redacted\.invalid$/);
    expect(data.email).not.toBe("buyer@example.com");
    expect(data.companyName).toBe("ERASED");
    expect(data.taxId).toBeNull();
    expect(data.phone).toBeNull();
    expect(data.addressJson).toBe(Prisma.DbNull);
    expect(data.clerkUserId).toBeNull();
    expect(data.passwordHash).toBe("");
    expect(data.anonymizedAt).toBeInstanceOf(Date);

    expect(m.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "gdpr_redacted",
          entityId: BUYER_ID,
        }),
      }),
    );
    expect(processedCall(m.webhookEventUpdate)).toBeDefined();
  });

  it("UNLINKS the requesting merchant but DEFERS the PII scrub while another merchant relationship remains", async () => {
    const m = setup({
      payload: { customer: { email: "buyer@example.com" } },
      buyer: { id: BUYER_ID, anonymizedAt: null },
      deletedCount: 1,
      otherRelationships: 2, // relationships still present AFTER the unlink
    });

    await m.service.redactCustomer(job());

    // The requesting merchant's own relationship is removed (documented policy)...
    expect(m.relationshipDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { buyerId: BUYER_ID, merchantId: MERCHANT_ID },
      }),
    );
    // ...but the shared identity's PII is retained (lawful basis elsewhere).
    expect(m.buyerUpdate).not.toHaveBeenCalled();
    expect(m.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "gdpr_relationship_unlinked" }),
      }),
    );
    expect(m.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "gdpr_redact_deferred_cross_merchant",
          entityId: BUYER_ID,
        }),
      }),
    );
    expect(processedCall(m.webhookEventUpdate)).toBeDefined();
  });

  it("completes a previously-deferred erasure: the LAST merchant's redact drops the count to zero and anonymizes", async () => {
    // Regression for the orphaned-erasure gap: counting alone never reached zero
    // because no row was ever removed. Now each redact unlinks its own row, so
    // the final redact leaves nothing behind and the buyer is anonymized.
    const m = setup({
      payload: { customer: { email: "buyer@example.com" } },
      buyer: { id: BUYER_ID, anonymizedAt: null },
      deletedCount: 1,
      otherRelationships: 0, // nothing remains after this unlink
    });

    await m.service.redactCustomer(job());

    expect(m.relationshipDelete).toHaveBeenCalledTimes(1);
    expect(m.buyerUpdate).toHaveBeenCalledTimes(1);
    const data = (
      m.buyerUpdate.mock.calls[0]![0] as { data: Record<string, unknown> }
    ).data;
    expect(data.anonymizedAt).toBeInstanceOf(Date);
    expect(data.clerkUserId).toBeNull();
    expect(data.passwordHash).toBe("");
    expect(m.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "gdpr_redacted" }),
      }),
    );
    expect(processedCall(m.webhookEventUpdate)).toBeDefined();
  });

  it("is an idempotent no-op when the buyer is already anonymized", async () => {
    const m = setup({
      payload: { customer: { email: "buyer@example.com" } },
      buyer: { id: BUYER_ID, anonymizedAt: new Date("2026-01-01") },
    });

    await m.service.redactCustomer(job());

    expect(m.relationshipCount).not.toHaveBeenCalled();
    expect(m.buyerUpdate).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
    expect(processedCall(m.webhookEventUpdate)).toBeDefined();
  });

  it("is a no-op (but still processed) when no platform buyer matches the email", async () => {
    const m = setup({
      payload: { customer: { email: "ghost@example.com" } },
      buyer: null,
    });

    await m.service.redactCustomer(job());

    expect(m.buyerUpdate).not.toHaveBeenCalled();
    expect(processedCall(m.webhookEventUpdate)).toBeDefined();
  });

  it("processes without looking up a buyer when the payload carries no email", async () => {
    const m = setup({ payload: { customer: {} } });

    await m.service.redactCustomer(job());

    expect(m.buyerFindUnique).not.toHaveBeenCalled();
    expect(m.buyerUpdate).not.toHaveBeenCalled();
    expect(processedCall(m.webhookEventUpdate)).toBeDefined();
  });

  it("bails cleanly when the webhook event row is missing (nothing to process)", async () => {
    const m = setup({ payload: {}, event: null });

    await m.service.redactCustomer(job());

    expect(m.webhookEventUpdate).not.toHaveBeenCalled();
    expect(m.buyerUpdate).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });
});

describe("GdprComplianceService.recordDataRequest", () => {
  it("audits against the buyer when the requested customer exists on the platform", async () => {
    const m = setup({
      payload: {
        customer: { email: "buyer@example.com" },
        data_request: { id: 987 },
      },
      buyer: { id: BUYER_ID, anonymizedAt: null },
    });

    await m.service.recordDataRequest(job());

    expect(m.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "gdpr_data_request_received",
          entityType: "buyer",
          entityId: BUYER_ID,
        }),
      }),
    );
    expect(processedCall(m.webhookEventUpdate)).toBeDefined();
  });

  it("falls back to the merchant entity when the customer is not a known buyer", async () => {
    const m = setup({
      payload: { customer: { email: "ghost@example.com" } },
      buyer: null,
      merchant: { id: MERCHANT_ID },
    });

    await m.service.recordDataRequest(job());

    expect(m.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityType: "merchant",
          entityId: MERCHANT_ID,
        }),
      }),
    );
    expect(processedCall(m.webhookEventUpdate)).toBeDefined();
  });

  it("still acks (processes) but writes no audit when neither buyer nor merchant is known", async () => {
    const m = setup({
      payload: { customer: { email: "ghost@example.com" } },
      buyer: null,
      merchant: null,
    });

    await m.service.recordDataRequest(job());

    expect(m.auditCreate).not.toHaveBeenCalled();
    expect(processedCall(m.webhookEventUpdate)).toBeDefined();
  });
});
