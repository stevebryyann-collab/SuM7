import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { addDays } from 'date-fns';
import Decimal from 'decimal.js';
import { merchantDisplayNameFromDomain } from '@b2b/shared';
import type { StandingOrder } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MerchantContextService } from '../prisma/merchant-context.service';
import { EmailService } from '../email/email.service';

/** Allowed reminder cadences (mirrors the standing_orders CHECK constraint). */
export type ReminderFrequencyDays = 7 | 14 | 30;

/** Human label for each cadence, used in reminder emails and the buyer UI. */
export const FREQUENCY_LABELS: Record<number, string> = {
  7: 'Weekly',
  14: 'Every 2 weeks',
  30: 'Monthly',
};

export function frequencyLabel(days: number): string {
  return FREQUENCY_LABELS[days] ?? `Every ${days} days`;
}

const REMINDER_BATCH_LIMIT = 500;

/**
 * Buyer-configured reorder reminders. Buyers manage their own standing orders
 * from the portal; the daily 08:00 cron sweeps due rows (as the SYSTEM, across
 * all merchants), emails the buyer, and rolls the schedule forward. Tenant
 * isolation for the buyer-facing methods is at the application layer
 * (`where: { buyerId, merchantId }`) — standing_orders carries no RLS because
 * buyer-portal handlers run without a tenant context (see migration 012).
 */
@Injectable()
export class StandingOrdersService {
  private readonly logger = new Logger(StandingOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantContext: MerchantContextService,
    private readonly email: EmailService,
  ) {}

  async createStandingOrder(
    buyerId: string,
    merchantId: string,
    sourceOrderId: string | undefined,
    name: string | undefined,
    frequencyDays: ReminderFrequencyDays,
  ): Promise<StandingOrder> {
    // A linked source order must belong to this buyer + merchant.
    if (sourceOrderId) {
      const order = await this.prisma.order.findFirst({
        where: { id: sourceOrderId, buyerId, merchantId },
        select: { id: true },
      });
      if (!order) {
        throw new NotFoundException({
          code: 'SOURCE_ORDER_NOT_FOUND',
          message: 'Source order not found for this buyer',
        });
      }
    }

    const nextReminderAt = addDays(new Date(), frequencyDays);
    const standingOrder = await this.prisma.standingOrder.create({
      data: {
        buyerId,
        merchantId,
        sourceOrderId: sourceOrderId ?? null,
        name: name?.trim() || 'Regular Order',
        reminderFrequencyDays: frequencyDays,
        nextReminderAt,
      },
    });

    this.logger.log(
      `Standing order ${standingOrder.id} created (buyer ${buyerId}, every ${frequencyDays}d)`,
    );
    return standingOrder;
  }

  async getActiveStandingOrders(buyerId: string, merchantId: string): Promise<StandingOrder[]> {
    return this.prisma.standingOrder.findMany({
      where: { buyerId, merchantId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deactivateStandingOrder(
    standingOrderId: string,
    buyerId: string,
    merchantId: string,
  ): Promise<void> {
    const result = await this.prisma.standingOrder.updateMany({
      where: { id: standingOrderId, buyerId, merchantId, isActive: true },
      data: { isActive: false },
    });
    if (result.count === 0) {
      throw new NotFoundException({
        code: 'STANDING_ORDER_NOT_FOUND',
        message: 'No active standing order found',
      });
    }
    this.logger.log(`Standing order ${standingOrderId} deactivated`);
  }

  /**
   * Daily sweep (08:00) of due reminders. Runs as the SYSTEM so it sees every
   * merchant's rows. Each reminder email is best-effort (the EmailService never
   * throws); a per-row failure is logged and skipped so one bad row cannot abort
   * the batch. After a successful attempt the schedule rolls forward.
   */
  @Cron('0 8 * * *')
  async sendStandingOrderReminders(): Promise<{ sentCount: number }> {
    return this.merchantContext.runAsSystem(async () => {
      const now = new Date();
      const due = await this.prisma.standingOrder.findMany({
        where: { isActive: true, nextReminderAt: { lte: now } },
        take: REMINDER_BATCH_LIMIT,
        select: {
          id: true,
          name: true,
          reminderFrequencyDays: true,
          buyer: { select: { email: true, companyName: true } },
          merchant: { select: { shopifyDomain: true } },
          sourceOrder: {
            select: {
              total: true,
              currency: true,
              lineItems: {
                select: { productTitle: true, variantTitle: true, quantity: true, lineTotal: true },
              },
            },
          },
        },
      });

      let sentCount = 0;
      for (const standingOrder of due) {
        try {
          const merchantName = merchantDisplayNameFromDomain(standingOrder.merchant.shopifyDomain);
          const portalUrl = `https://${standingOrder.merchant.shopifyDomain}`;
          const lastOrder = standingOrder.sourceOrder
            ? {
                total: new Decimal(standingOrder.sourceOrder.total.toString()).toFixed(2),
                currency: standingOrder.sourceOrder.currency,
                lineItems: standingOrder.sourceOrder.lineItems.map((li) => ({
                  description:
                    li.productTitle + (li.variantTitle ? ` — ${li.variantTitle}` : ''),
                  quantity: li.quantity,
                  lineTotal: new Decimal(li.lineTotal.toString()).toFixed(2),
                })),
              }
            : null;

          const result = await this.email.sendStandingOrderReminderEmail({
            to: standingOrder.buyer.email,
            merchantName,
            buyerCompany: standingOrder.buyer.companyName,
            standingOrderName: standingOrder.name,
            frequencyLabel: frequencyLabel(standingOrder.reminderFrequencyDays),
            portalUrl,
            manageUrl: `${portalUrl}/account`,
            lastOrder,
          });
          if (result.sent) sentCount += 1;

          await this.prisma.standingOrder.update({
            where: { id: standingOrder.id },
            data: {
              lastReminderAt: now,
              nextReminderAt: addDays(now, standingOrder.reminderFrequencyDays),
            },
          });
        } catch (error) {
          this.logger.error(
            `Standing-order reminder ${standingOrder.id} failed: ${(error as Error).message}`,
          );
        }
      }

      if (due.length > 0) {
        this.logger.log(`Standing-order reminders: ${sentCount}/${due.length} sent`);
      }
      return { sentCount };
    });
  }
}
