import { Injectable, ConflictException, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { ShoppingList, ShoppingListItem } from '@prisma/client';

export interface ShoppingListSummary {
  id: string;
  name: string;
  itemCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CartItemDto {
  shopifyVariantId: string;
  shopifyProductId: string;
  productTitle: string;
  variantTitle?: string;
  sku?: string;
  quantity: number;
}

@Injectable()
export class ShoppingListsService {
  private readonly logger = new Logger(ShoppingListsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createList(
    buyerId: string,
    merchantId: string,
    name: string,
    correlationId?: string,
  ): Promise<ShoppingList> {
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > 100) {
      throw new BadRequestException({ code: 'INVALID_LIST_NAME', message: 'List name must be 1-100 characters' });
    }

    try {
      return await this.prisma.shoppingList.create({
        data: { buyerId, merchantId, name: trimmed },
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new ConflictException({ code: 'LIST_NAME_EXISTS', message: 'A list with this name already exists' });
      }
      this.logger.error('Failed to create shopping list', { buyerId, merchantId, error, correlationId });
      throw error;
    }
  }

  async saveCartToList(
    buyerId: string,
    merchantId: string,
    listId: string,
    cartItems: CartItemDto[],
    correlationId?: string,
  ): Promise<void> {
    if (cartItems.length > 200) {
      throw new BadRequestException({ code: 'TOO_MANY_ITEMS', message: 'Maximum 200 items per list' });
    }

    const list = await this.prisma.shoppingList.findUnique({
      where: { id: listId },
      select: { buyerId: true, merchantId: true },
    });

    if (!list || list.buyerId !== buyerId || list.merchantId !== merchantId) {
      throw new NotFoundException({ code: 'LIST_NOT_FOUND', message: 'Shopping list not found' });
    }

    await this.prisma.$transaction(async (tx) => {
      // Clear existing items
      await tx.shoppingListItem.deleteMany({ where: { listId } });

      // Insert new items
      if (cartItems.length > 0) {
        await tx.shoppingListItem.createMany({
          data: cartItems.map((item) => ({
            listId,
            shopifyVariantId: item.shopifyVariantId,
            shopifyProductId: item.shopifyProductId,
            productTitle: item.productTitle,
            variantTitle: item.variantTitle ?? null,
            sku: item.sku ?? null,
            quantity: item.quantity,
          })),
        });
      }

      // Update list timestamp
      await tx.shoppingList.update({
        where: { id: listId },
        data: { updatedAt: new Date() },
      });
    });

    this.logger.log('Cart saved to shopping list', { listId, itemCount: cartItems.length, correlationId });
  }

  async getLists(buyerId: string, merchantId: string): Promise<ShoppingListSummary[]> {
    const lists = await this.prisma.shoppingList.findMany({
      where: { buyerId, merchantId },
      select: {
        id: true,
        name: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { items: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return lists.map((list) => ({
      id: list.id,
      name: list.name,
      itemCount: list._count.items,
      createdAt: list.createdAt,
      updatedAt: list.updatedAt,
    }));
  }

  async getListItems(
    listId: string,
    buyerId: string,
    merchantId: string,
  ): Promise<ShoppingListItem[]> {
    const list = await this.prisma.shoppingList.findUnique({
      where: { id: listId },
      select: { buyerId: true, merchantId: true },
    });

    if (!list || list.buyerId !== buyerId || list.merchantId !== merchantId) {
      throw new NotFoundException({ code: 'LIST_NOT_FOUND', message: 'Shopping list not found' });
    }

    return this.prisma.shoppingListItem.findMany({
      where: { listId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async deleteList(
    listId: string,
    buyerId: string,
    merchantId: string,
    correlationId?: string,
  ): Promise<void> {
    const list = await this.prisma.shoppingList.findUnique({
      where: { id: listId },
      select: { buyerId: true, merchantId: true },
    });

    if (!list || list.buyerId !== buyerId || list.merchantId !== merchantId) {
      throw new NotFoundException({ code: 'LIST_NOT_FOUND', message: 'Shopping list not found' });
    }

    await this.prisma.shoppingList.delete({ where: { id: listId } });
    this.logger.log('Shopping list deleted', { listId, correlationId });
  }

  async renameList(
    listId: string,
    buyerId: string,
    merchantId: string,
    newName: string,
    correlationId?: string,
  ): Promise<void> {
    const trimmed = newName.trim();
    if (trimmed.length === 0 || trimmed.length > 100) {
      throw new BadRequestException({ code: 'INVALID_LIST_NAME', message: 'List name must be 1-100 characters' });
    }

    const list = await this.prisma.shoppingList.findUnique({
      where: { id: listId },
      select: { buyerId: true, merchantId: true },
    });

    if (!list || list.buyerId !== buyerId || list.merchantId !== merchantId) {
      throw new NotFoundException({ code: 'LIST_NOT_FOUND', message: 'Shopping list not found' });
    }

    try {
      await this.prisma.shoppingList.update({
        where: { id: listId },
        data: { name: trimmed },
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new ConflictException({ code: 'LIST_NAME_EXISTS', message: 'A list with this name already exists' });
      }
      this.logger.error('Failed to rename shopping list', { listId, error, correlationId });
      throw error;
    }
  }
}
