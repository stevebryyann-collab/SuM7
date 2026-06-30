import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ClerkBuyerGuard, type BuyerAuthenticatedRequest } from '../auth/guards/clerk-buyer.guard';
import {
  StandingOrdersService,
  frequencyLabel,
  type ReminderFrequencyDays,
} from './standing-orders.service';
import type { StandingOrder } from '@prisma/client';

const CreateStandingOrderSchema = z.object({
  sourceOrderId: z.string().uuid().optional(),
  name: z.string().trim().max(100).optional(),
  frequencyDays: z.union([z.literal(7), z.literal(14), z.literal(30)]),
});

/** The buyer-facing shape of a standing order (frequency label resolved). */
interface StandingOrderDto {
  id: string;
  name: string;
  frequencyDays: number;
  frequencyLabel: string;
  nextReminderAt: string;
  lastReminderAt: string | null;
  sourceOrderId: string | null;
  isActive: boolean;
}

function toDto(standingOrder: StandingOrder): StandingOrderDto {
  return {
    id: standingOrder.id,
    name: standingOrder.name,
    frequencyDays: standingOrder.reminderFrequencyDays,
    frequencyLabel: frequencyLabel(standingOrder.reminderFrequencyDays),
    nextReminderAt: standingOrder.nextReminderAt.toISOString(),
    lastReminderAt: standingOrder.lastReminderAt ? standingOrder.lastReminderAt.toISOString() : null,
    sourceOrderId: standingOrder.sourceOrderId,
    isActive: standingOrder.isActive,
  };
}

/**
 * Buyer-portal reorder reminders. All routes are authenticated with
 * {@link ClerkBuyerGuard}; the buyer + merchant scope comes from the resolved
 * buyer principal, never the request body.
 */
@Controller('buyer/standing-orders')
@UseGuards(ClerkBuyerGuard)
export class StandingOrdersController {
  constructor(private readonly service: StandingOrdersService) {}

  @Get()
  async list(@Req() req: BuyerAuthenticatedRequest): Promise<{ standingOrders: StandingOrderDto[] }> {
    const { buyerId, merchantId } = req.buyer!;
    const rows = await this.service.getActiveStandingOrders(buyerId, merchantId);
    return { standingOrders: rows.map(toDto) };
  }

  @Post()
  async create(
    @Req() req: BuyerAuthenticatedRequest,
    @Body(new ZodValidationPipe(CreateStandingOrderSchema))
    body: z.infer<typeof CreateStandingOrderSchema>,
  ): Promise<StandingOrderDto> {
    const { buyerId, merchantId } = req.buyer!;
    const created = await this.service.createStandingOrder(
      buyerId,
      merchantId,
      body.sourceOrderId,
      body.name,
      body.frequencyDays as ReminderFrequencyDays,
    );
    return toDto(created);
  }

  @Delete(':id')
  async deactivate(
    @Req() req: BuyerAuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<{ deactivated: true }> {
    const { buyerId, merchantId } = req.buyer!;
    await this.service.deactivateStandingOrder(id, buyerId, merchantId);
    return { deactivated: true };
  }
}
