import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { createHmac } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import type { Queue } from "bullmq";
import { ComplianceWebhooksController } from "./compliance-webhooks.controller";
import type { AppConfigService } from "../config/app-config.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { MerchantContextService } from "../prisma/merchant-context.service";
import {
  JOB_GDPR_CUSTOMER_REDACT,
  JOB_GDPR_DATA_REQUEST,
  JOB_MERCHANT_PURGE_DATA,
} from "../queues/queue.module";

/**
 * Shopify's three mandatory compliance webhooks are an automatic-rejection
 * surface, so these tests pin the security contract exactly: HMAC is verified
 * (base64 HMAC-SHA256 of the RAW body, timing-safe) BEFORE any DB write or
 * enqueue; a bad/missing signature is a 401 that records and enqueues nothing;
 * a duplicate delivery (P2002 on the domain+event-id unique index) is a silent
 * 200 with no re-enqueue; and every topic reaches its fulfillment queue via both
 * the single dispatcher and the explicit routes. Prisma/queues are mocked.
 */

const SECRET = "shpss_test_secret";
const SHOP = "acme.myshopify.com";
const EVENT_ID = "evt-abc-123";

interface Harness {
  controller: ComplianceWebhooksController;
  webhookEventCreate: jest.Mock;
  merchantFindFirst: jest.Mock;
  buyerAdd: jest.Mock;
  merchantAdd: jest.Mock;
}

function setup(overrides?: {
  createImpl?: () => Promise<{ id: string }>;
  merchant?: { id: string } | null;
}): Harness {
  const webhookEventCreate = jest.fn(
    overrides?.createImpl ?? (async () => ({ id: "wh-event-1" })),
  );
  const merchantFindFirst = jest.fn(async () =>
    overrides?.merchant === undefined ? { id: "merch-1" } : overrides.merchant,
  );

  const prisma = {
    webhookEvent: { create: webhookEventCreate },
    merchant: { findFirst: merchantFindFirst },
  } as unknown as PrismaService;

  const config = {
    get: (key: string) =>
      key === "SHOPIFY_CLIENT_SECRET" ? SECRET : undefined,
  } as unknown as AppConfigService;

  // runAsSystem is a synchronous passthrough in the real service.
  const merchantContext = {
    runAsSystem: <T>(fn: () => T): T => fn(),
  } as unknown as MerchantContextService;

  const buyerAdd = jest.fn().mockResolvedValue({ id: "job-1" });
  const merchantAdd = jest.fn().mockResolvedValue({ id: "job-2" });
  const buyerQueue = { add: buyerAdd } as unknown as Queue;
  const merchantQueue = { add: merchantAdd } as unknown as Queue;

  const controller = new ComplianceWebhooksController(
    config,
    prisma,
    merchantContext,
    buyerQueue as never,
    merchantQueue as never,
  );
  return {
    controller,
    webhookEventCreate,
    merchantFindFirst,
    buyerAdd,
    merchantAdd,
  };
}

/** Build a fake raw-body request with a correctly-signed (or overridden) HMAC. */
function makeReq(
  body: unknown,
  opts?: {
    hmac?: string | undefined; // override the signature; undefined = omit header
    signWith?: string; // sign the body with a different secret (forge)
    domain?: string;
    eventId?: string;
    createdAt?: string;
    rawBody?: Buffer | undefined;
  },
): RawBodyRequest<Request> {
  const raw = Buffer.from(JSON.stringify(body));
  const validHmac = createHmac("sha256", opts?.signWith ?? SECRET)
    .update(raw)
    .digest("base64");
  const headers: Record<string, string> = {
    "x-shopify-shop-domain": opts?.domain ?? SHOP,
    "x-shopify-webhook-id": opts?.eventId ?? EVENT_ID,
  };
  if (opts?.createdAt) headers["x-shopify-webhook-created-at"] = opts.createdAt;
  const hmacHeader = "hmac" in (opts ?? {}) ? opts?.hmac : validHmac;
  if (hmacHeader !== undefined) headers["x-shopify-hmac-sha256"] = hmacHeader;

  return {
    rawBody: "rawBody" in (opts ?? {}) ? opts?.rawBody : raw,
    headers,
    body,
  } as unknown as RawBodyRequest<Request>;
}

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "5.19.1",
  });
}

describe("ComplianceWebhooksController", () => {
  describe("HMAC gate (runs before any side effect)", () => {
    it("rejects a request with no HMAC header and records nothing", async () => {
      const h = setup();
      const req = makeReq({ shop_domain: SHOP }, { hmac: undefined });
      await expect(h.controller.shopRedact(req)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(h.webhookEventCreate).not.toHaveBeenCalled();
      expect(h.merchantAdd).not.toHaveBeenCalled();
    });

    it("rejects a forged signature (signed with the wrong secret)", async () => {
      const h = setup();
      const req = makeReq({ shop_domain: SHOP }, { signWith: "wrong_secret" });
      await expect(h.controller.shopRedact(req)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(h.webhookEventCreate).not.toHaveBeenCalled();
    });

    it("rejects when the raw body is unavailable", async () => {
      const h = setup();
      const req = makeReq({ shop_domain: SHOP }, { rawBody: undefined });
      await expect(h.controller.shopRedact(req)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(h.webhookEventCreate).not.toHaveBeenCalled();
    });

    it("rejects a same-length-but-wrong signature without throwing on timingSafeEqual", async () => {
      const h = setup();
      const raw = Buffer.from(JSON.stringify({ shop_domain: SHOP }));
      const valid = createHmac("sha256", SECRET).update(raw).digest("base64");
      // Flip the first character but keep the length identical.
      const tampered = (valid[0] === "A" ? "B" : "A") + valid.slice(1);
      const req = makeReq({ shop_domain: SHOP }, { hmac: tampered });
      await expect(h.controller.shopRedact(req)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(h.webhookEventCreate).not.toHaveBeenCalled();
    });
  });

  describe("dispatch() single endpoint (compliance_topics)", () => {
    it("routes customers/data_request to the buyer queue", async () => {
      const h = setup();
      const req = makeReq({ customer: { email: "b@x.com" } });
      const res = await h.controller.dispatch(req, "customers/data_request");
      expect(res).toEqual({ received: true });
      expect(h.buyerAdd).toHaveBeenCalledWith(
        JOB_GDPR_DATA_REQUEST,
        expect.objectContaining({
          webhookEventId: "wh-event-1",
          shopifyDomain: SHOP,
        }),
        expect.objectContaining({ priority: expect.any(Number) }),
      );
    });

    it("routes customers/redact to the buyer queue", async () => {
      const h = setup();
      const req = makeReq({ customer: { email: "b@x.com" } });
      await h.controller.dispatch(req, "customers/redact");
      expect(h.buyerAdd).toHaveBeenCalledWith(
        JOB_GDPR_CUSTOMER_REDACT,
        expect.objectContaining({ shopifyDomain: SHOP }),
        expect.any(Object),
      );
    });

    it("routes shop/redact to the merchant purge queue", async () => {
      const h = setup();
      const req = makeReq({ shop_domain: SHOP });
      await h.controller.dispatch(req, "shop/redact");
      expect(h.merchantAdd).toHaveBeenCalledWith(
        JOB_MERCHANT_PURGE_DATA,
        { merchantId: "merch-1" },
        expect.any(Object),
      );
    });

    it("400s on an unknown/absent topic even when the signature is valid", async () => {
      const h = setup();
      const req = makeReq({ anything: true });
      await expect(
        h.controller.dispatch(req, "orders/create"),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        h.controller.dispatch(req, undefined),
      ).rejects.toBeInstanceOf(BadRequestException);
      // A validly-signed unknown topic must not be silently swallowed.
      expect(h.webhookEventCreate).not.toHaveBeenCalled();
    });
  });

  describe("idempotency (duplicate delivery)", () => {
    it("acks 200 without re-enqueuing when the event id already exists (P2002)", async () => {
      const h = setup({ createImpl: async () => Promise.reject(p2002()) });
      const req = makeReq({ customer: { email: "b@x.com" } });
      const res = await h.controller.customersRedact(req);
      expect(res).toEqual({ received: true });
      expect(h.buyerAdd).not.toHaveBeenCalled();
    });

    it("re-throws non-P2002 database errors (does not swallow real failures)", async () => {
      const boom = new Error("connection reset");
      const h = setup({ createImpl: async () => Promise.reject(boom) });
      const req = makeReq({ customer: { email: "b@x.com" } });
      await expect(h.controller.customersDataRequest(req)).rejects.toBe(boom);
      expect(h.buyerAdd).not.toHaveBeenCalled();
    });
  });

  describe("shop/redact when the merchant is already gone (post-uninstall)", () => {
    it("still acks 200 and enqueues no purge when no merchant row exists", async () => {
      const h = setup({ merchant: null });
      const req = makeReq({ shop_domain: SHOP });
      const res = await h.controller.shopRedact(req);
      expect(res).toEqual({ received: true });
      expect(h.webhookEventCreate).toHaveBeenCalledTimes(1);
      expect(h.merchantAdd).not.toHaveBeenCalled();
    });
  });

  describe("explicit per-topic routes converge on the same fulfillment", () => {
    it("customers/data-request route enqueues the data-request job", async () => {
      const h = setup();
      const req = makeReq({ customer: { email: "b@x.com" } });
      await h.controller.customersDataRequest(req);
      expect(h.buyerAdd).toHaveBeenCalledWith(
        JOB_GDPR_DATA_REQUEST,
        expect.any(Object),
        expect.any(Object),
      );
    });
  });
});
