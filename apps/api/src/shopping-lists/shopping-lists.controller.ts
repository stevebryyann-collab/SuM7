import { Controller, Get, Post, Patch, Delete, Body, Param, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ClerkBuyerGuard, type BuyerAuthenticatedRequest } from '../auth/guards/clerk-buyer.guard';
import { ShoppingListsService, type ShoppingListSummary } from './shopping-lists.service';
import type { ShoppingList, ShoppingListItem } from '@prisma/client';

const CreateListSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

const RenameListSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

const SaveCartSchema = z.object({
  items: z.array(
    z.object({
      shopifyVariantId: z.string(),
      shopifyProductId: z.string(),
      productTitle: z.string(),
      variantTitle: z.string().optional(),
      sku: z.string().optional(),
      quantity: z.number().int().min(1).max(9999),
    }),
  ).max(200),
});

@Controller('buyer/shopping-lists')
@UseGuards(ClerkBuyerGuard)
export class ShoppingListsController {
  constructor(private readonly service: ShoppingListsService) {}

  @Get()
  getLists(@Req() req: BuyerAuthenticatedRequest): Promise<ShoppingListSummary[]> {
    const { buyerId, merchantId } = req.buyer!;
    return this.service.getLists(buyerId, merchantId);
  }

  @Post()
  createList(
    @Req() req: BuyerAuthenticatedRequest,
    @Body(new ZodValidationPipe(CreateListSchema)) body: z.infer<typeof CreateListSchema>,
  ): Promise<ShoppingList> {
    const { buyerId, merchantId } = req.buyer!;
    const correlationId = req.headers['x-correlation-id'] as string | undefined;
    return this.service.createList(buyerId, merchantId, body.name, correlationId);
  }

  @Get(':id')
  getListItems(
    @Req() req: BuyerAuthenticatedRequest,
    @Param('id') listId: string,
  ): Promise<ShoppingListItem[]> {
    const { buyerId, merchantId } = req.buyer!;
    return this.service.getListItems(listId, buyerId, merchantId);
  }

  @Post(':id/save-cart')
  saveCartToList(
    @Req() req: BuyerAuthenticatedRequest,
    @Param('id') listId: string,
    @Body(new ZodValidationPipe(SaveCartSchema)) body: z.infer<typeof SaveCartSchema>,
  ): Promise<void> {
    const { buyerId, merchantId } = req.buyer!;
    const correlationId = req.headers['x-correlation-id'] as string | undefined;
    return this.service.saveCartToList(buyerId, merchantId, listId, body.items, correlationId);
  }

  @Patch(':id')
  renameList(
    @Req() req: BuyerAuthenticatedRequest,
    @Param('id') listId: string,
    @Body(new ZodValidationPipe(RenameListSchema)) body: z.infer<typeof RenameListSchema>,
  ): Promise<void> {
    const { buyerId, merchantId } = req.buyer!;
    const correlationId = req.headers['x-correlation-id'] as string | undefined;
    return this.service.renameList(listId, buyerId, merchantId, body.name, correlationId);
  }

  @Delete(':id')
  deleteList(
    @Req() req: BuyerAuthenticatedRequest,
    @Param('id') listId: string,
  ): Promise<void> {
    const { buyerId, merchantId } = req.buyer!;
    const correlationId = req.headers['x-correlation-id'] as string | undefined;
    return this.service.deleteList(listId, buyerId, merchantId, correlationId);
  }
}
