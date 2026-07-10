// The Paddle SDK is stubbed so constructing BillingService makes no network call
// and we can drive createOneTimeCharge directly.
jest.mock("@paddle/paddle-node-sdk", () => ({
  Paddle: jest.fn().mockImplementation(() => ({ subscriptions: {} })),
  Environment: { production: "production", sandbox: "sandbox" },
  ApiError: class ApiError extends Error {},
}));

import { Decimal } from "decimal.js";
import { BillingService } from "./billing.service";
import type { AppConfigService } from "../config/app-config.service";
import type { CircuitBreakerFactory } from "../common/circuit-breaker/circuit-breaker.factory";
import type { PrismaService } from "../prisma/prisma.service";
import type { MerchantContextService } from "../prisma/merchant-context.service";
import type { EmailService } from "../email/email.service";
import type { Redis } from "ioredis";

/**
 * GMV overage billing is a Merchant-of-Record money movement, so these tests pin
 * the two invariants that matter most: the per-tier fee math (Decimal, banker's
 * rounding, free-threshold subtraction) and — above all — that a merchant is
 * NEVER double-charged. The idempotency latch (`chargedAt`) may only be released
 * for retry when the charge provably never reached Paddle (circuit breaker open);
 * an ambiguous failure keeps the latch claimed so a retry cannot re-bill.
 */

const MERCHANT_ID = "22222222-2222-2222-2222-222222222222";
const MONTH = "2026-06";

function eopenbreaker(): Error {
  return Object.assign(new Error("Breaker is open"), { code: "EOPENBREAKER" });
}

interface Harness {
  service: BillingService;
  createOneTimeCharge: jest.Mock;
  updateMany: jest.Mock;
  auditCreate: jest.Mock;
  ledgerFindUnique: jest.Mock;
  breaker: { fire: (action: () => Promise<unknown>) => Promise<unknown> };
}

function setup(opts: {
  gmv: string | null;
  chargedAt?: Date | null;
  tier?: string;
  subscriptionPaddleId?: string | null;
  charge?: () => Promise<unknown>;
  breakerFire?: (action: () => Promise<unknown>) => Promise<unknown>;
}): Harness {
  const createOneTimeCharge = jest.fn(
    opts.charge ?? (async () => ({ id: "txn_success_1" })),
  );
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const auditCreate = jest.fn().mockResolvedValue({});
  const ledgerFindUnique = jest
    .fn()
    .mockResolvedValue(
      opts.gmv === null
        ? null
        : { gmv: new Decimal(opts.gmv), chargedAt: opts.chargedAt ?? null },
    );

  const prisma = {
    merchant: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        subscriptionTier: opts.tier ?? "growth",
        subscriptionPaddleId:
          opts.subscriptionPaddleId === undefined
            ? "sub_123"
            : opts.subscriptionPaddleId,
      }),
    },
    merchantMonthlyGmv: { findUnique: ledgerFindUnique, updateMany },
    auditLog: { create: auditCreate },
  } as unknown as PrismaService;

  const merchantContext = {
    runAsSystem: <T>(fn: () => T): T => fn(),
  } as unknown as MerchantContextService;

  const config = {
    get: (key: string) =>
      (
        ({
          PADDLE_API_KEY: "apikey_test",
          PADDLE_ENV: "sandbox",
          PADDLE_GMV_PRICE_ID: "pri_gmv",
        }) as Record<string, string>
      )[key],
  } as unknown as AppConfigService;

  const breaker = {
    fire: opts.breakerFire ?? ((action: () => Promise<unknown>) => action()),
  };
  const breakerFactory = {
    create: () => breaker,
  } as unknown as CircuitBreakerFactory;

  const service = new BillingService(
    config,
    breakerFactory,
    prisma,
    merchantContext,
    {} as unknown as EmailService,
    {} as unknown as Redis,
    {} as unknown as Redis,
  );
  service.onModuleInit();
  (
    service as unknown as {
      paddle: { subscriptions: { createOneTimeCharge: jest.Mock } };
    }
  ).paddle = { subscriptions: { createOneTimeCharge } };

  return {
    service,
    createOneTimeCharge,
    updateMany,
    auditCreate,
    ledgerFindUnique,
    breaker,
  };
}

/** updateMany calls that RELEASE the latch (chargedAt → null). */
function releaseCalls(updateMany: jest.Mock): unknown[] {
  return updateMany.mock.calls.filter(
    ([arg]) =>
      (arg as { data?: { chargedAt?: unknown } })?.data?.chargedAt === null,
  );
}

/** updateMany call args that anchor the Paddle charge id onto the ledger row. */
function chargeIdCalls(updateMany: jest.Mock): unknown[] {
  return updateMany.mock.calls
    .map(([arg]) => arg)
    .filter(
      (arg) => "paddleChargeId" in ((arg as { data?: object })?.data ?? {}),
    );
}

describe("BillingService.chargeMonthlyGmvOverage", () => {
  it("charges the exact per-tier fee and anchors the Paddle charge id on success", async () => {
    // growth: threshold 50 000, rate 0.004. gmv 100 000 → billable 50 000 →
    // fee = 50 000 * 0.004 * 100 = 20 000 cents.
    const h = setup({ gmv: "100000" });

    const charged = await h.service.chargeMonthlyGmvOverage(MERCHANT_ID, MONTH);

    expect(charged).toBe(true);
    expect(h.createOneTimeCharge).toHaveBeenCalledTimes(1);
    expect(h.createOneTimeCharge).toHaveBeenCalledWith(
      "sub_123",
      expect.objectContaining({
        effectiveFrom: "immediately",
        items: [{ priceId: "pri_gmv", quantity: 20000 }],
      }),
    );
    // The successful charge id is persisted for reconciliation.
    const idWrites = chargeIdCalls(h.updateMany) as {
      data: { paddleChargeId: string };
    }[];
    expect(idWrites).toHaveLength(1);
    expect(idWrites[0]!.data.paddleChargeId).toBe("txn_success_1");
    // Latch was never released.
    expect(releaseCalls(h.updateMany)).toHaveLength(0);
    expect(h.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "gmv_charged",
          newValueJson: expect.objectContaining({
            feeCents: 20000,
            paddleChargeId: "txn_success_1",
          }),
        }),
      }),
    );
  });

  it("does NOT release the latch on an ambiguous Paddle failure (no double-charge on retry)", async () => {
    // A timeout/5xx after the charge may have committed — releasing the latch
    // here is exactly what would let a retry bill the merchant twice.
    const h = setup({
      gmv: "100000",
      charge: async () => {
        throw new Error("ETIMEDOUT: Paddle did not respond");
      },
    });

    await expect(
      h.service.chargeMonthlyGmvOverage(MERCHANT_ID, MONTH),
    ).rejects.toThrow(/ETIMEDOUT/);

    // Claim happened (1 updateMany), but the latch was NOT reset.
    expect(releaseCalls(h.updateMany)).toHaveLength(0);
    expect(chargeIdCalls(h.updateMany)).toHaveLength(0);
    // The month is left claimed so no run re-charges it automatically.
    expect(h.auditCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "gmv_charged" }),
      }),
    );
  });

  it("releases the latch when the circuit breaker is open (charge never sent → safe to retry)", async () => {
    const h = setup({
      gmv: "100000",
      breakerFire: async () => Promise.reject(eopenbreaker()),
    });

    await expect(
      h.service.chargeMonthlyGmvOverage(MERCHANT_ID, MONTH),
    ).rejects.toThrow(/Breaker is open/);

    // The action never ran, and the latch was released for a later retry.
    expect(h.createOneTimeCharge).not.toHaveBeenCalled();
    expect(releaseCalls(h.updateMany)).toHaveLength(1);
  });

  it("short-circuits an already-charged month without touching Paddle", async () => {
    const h = setup({ gmv: "100000", chargedAt: new Date("2026-07-01") });

    const charged = await h.service.chargeMonthlyGmvOverage(MERCHANT_ID, MONTH);

    expect(charged).toBe(false);
    expect(h.createOneTimeCharge).not.toHaveBeenCalled();
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it("does not charge when GMV is at or below the tier's free threshold", async () => {
    // growth threshold is 50 000; 40 000 is below it → nothing billable.
    const h = setup({ gmv: "40000" });

    const charged = await h.service.chargeMonthlyGmvOverage(MERCHANT_ID, MONTH);

    expect(charged).toBe(false);
    expect(h.createOneTimeCharge).not.toHaveBeenCalled();
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it("loses no billing when a concurrent pod already claimed the month (latch race)", async () => {
    // updateMany claim returns count 0 → another run/pod won the compare-and-set.
    const h = setup({ gmv: "100000" });
    h.updateMany.mockResolvedValueOnce({ count: 0 });

    const charged = await h.service.chargeMonthlyGmvOverage(MERCHANT_ID, MONTH);

    expect(charged).toBe(false);
    expect(h.createOneTimeCharge).not.toHaveBeenCalled();
  });
});
