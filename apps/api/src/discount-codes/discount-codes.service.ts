import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import Decimal from 'decimal.js';
import type { B2bDiscountCode } from '@prisma/client';

export interface DiscountValidationResult {
  valid: boolean;
  code?: B2bDiscountCode;
  discountAmount?: Decimal;
  discountedTotal?: Decimal;
  invalidReason?: 'not_found' | 'expired' | 'max_uses_reached' | 'min_order_not_met' | 'inactive';
}

export interface CreateDiscountCodeDto {
  code: string;
  description?: string;
  discountType: 'pct_off' | 'fixed_amount';
  discountValue: number;
  minOrderAmount?: number;
  maxUses?: number;
  validFrom?: Date;
  validTo?: Date;
  appliesTo?: string;
}

export interface DiscountCodeStats {
  usedCount: number;
  totalDiscountGiven: Decimal;
}

@Injectable()
export class DiscountCodesService {
  private readonly logger = new Logger(DiscountCodesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async validateCode(
    merchantId: string,
    code: string,
    orderTotal: Decimal,
    correlationId?: string,
  ): Promise<DiscountValidationResult> {
    const upperCode = code.toUpperCase();

    const discountCode = await this.prisma.b2bDiscountCode.findFirst({
      where: {
        merchantId,
        code: { equals: upperCode, mode: 'insensitive' },
      },
    });

    if (!discountCode) {
      return { valid: false, invalidReason: 'not_found' };
    }

    if (!discountCode.isActive) {
      return { valid: false, invalidReason: 'inactive' };
    }

    const now = new Date();
    if (discountCode.validFrom && discountCode.validFrom > now) {
      return { valid: false, invalidReason: 'expired' };
    }

    if (discountCode.validTo && discountCode.validTo < now) {
      return { valid: false, invalidReason: 'expired' };
    }

    if (discountCode.maxUses !== null && discountCode.usedCount >= discountCode.maxUses) {
      return { valid: false, invalidReason: 'max_uses_reached' };
    }

    if (discountCode.minOrderAmount !== null) {
      const minAmount = new Decimal(discountCode.minOrderAmount.toString());
      if (orderTotal.lessThan(minAmount)) {
        return { valid: false, invalidReason: 'min_order_not_met' };
      }
    }

    // Calculate discount amount
    let discountAmount: Decimal;
    if (discountCode.discountType === 'pct_off') {
      const pct = new Decimal(discountCode.discountValue.toString()).div(100);
      discountAmount = orderTotal.mul(pct).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
    } else {
      // fixed_amount — cannot exceed order total
      const fixedValue = new Decimal(discountCode.discountValue.toString());
      discountAmount = Decimal.min(fixedValue, orderTotal);
    }

    const discountedTotal = orderTotal.minus(discountAmount);

    this.logger.log('Discount code validated', {
      code: upperCode,
      orderTotal: orderTotal.toString(),
      discountAmount: discountAmount.toString(),
      correlationId,
    });

    return {
      valid: true,
      code: discountCode,
      discountAmount,
      discountedTotal,
    };
  }

  async applyCodeToOrder(codeId: string): Promise<void> {
    await this.prisma.b2bDiscountCode.update({
      where: { id: codeId },
      data: { usedCount: { increment: 1 } },
    });
  }

  async listCodes(
    merchantId: string,
    cursor?: string,
    limit: number = 50,
  ): Promise<{ codes: B2bDiscountCode[]; nextCursor: string | null }> {
    const codes = await this.prisma.b2bDiscountCode.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      cursor: cursor ? { id: cursor } : undefined,
    });

    const hasMore = codes.length > limit;
    const items = hasMore ? codes.slice(0, limit) : codes;
    const nextCursor = hasMore ? items[items.length - 1]!.id : null;

    return { codes: items, nextCursor };
  }

  async createCode(
    merchantId: string,
    dto: CreateDiscountCodeDto,
    actorId?: string,
    correlationId?: string,
  ): Promise<B2bDiscountCode> {
    // Validate discount value
    if (dto.discountValue <= 0) {
      throw new BadRequestException({ code: 'INVALID_DISCOUNT_VALUE', message: 'Discount value must be greater than 0' });
    }

    if (dto.discountType === 'pct_off' && dto.discountValue > 100) {
      throw new BadRequestException({ code: 'INVALID_DISCOUNT_VALUE', message: 'Percentage discount cannot exceed 100%' });
    }

    const code = await this.prisma.b2bDiscountCode.create({
      data: {
        merchantId,
        code: dto.code.toUpperCase(),
        description: dto.description,
        discountType: dto.discountType,
        discountValue: new Decimal(dto.discountValue),
        minOrderAmount: dto.minOrderAmount ? new Decimal(dto.minOrderAmount) : null,
        maxUses: dto.maxUses ?? null,
        validFrom: dto.validFrom ?? null,
        validTo: dto.validTo ?? null,
        appliesTo: dto.appliesTo ?? 'all',
        createdBy: actorId ?? null,
      },
    });

    this.logger.log('Discount code created', { codeId: code.id, code: code.code, correlationId });
    return code;
  }

  async deactivateCode(
    codeId: string,
    merchantId: string,
    correlationId?: string,
  ): Promise<void> {
    const code = await this.prisma.b2bDiscountCode.findUnique({
      where: { id: codeId },
      select: { merchantId: true },
    });

    if (!code || code.merchantId !== merchantId) {
      throw new NotFoundException({ code: 'DISCOUNT_CODE_NOT_FOUND', message: 'Discount code not found' });
    }

    await this.prisma.b2bDiscountCode.update({
      where: { id: codeId },
      data: { isActive: false },
    });

    this.logger.log('Discount code deactivated', { codeId, correlationId });
  }

  async getCodeStats(
    codeId: string,
    merchantId: string,
  ): Promise<DiscountCodeStats> {
    const code = await this.prisma.b2bDiscountCode.findUnique({
      where: { id: codeId },
      select: { merchantId: true, usedCount: true },
    });

    if (!code || code.merchantId !== merchantId) {
      throw new NotFoundException({ code: 'DISCOUNT_CODE_NOT_FOUND', message: 'Discount code not found' });
    }

    // Sum discount amounts from orders using this code
    const result = await this.prisma.order.aggregate({
      where: { discountCodeId: codeId },
      _sum: { discountAmount: true },
    });

    return {
      usedCount: code.usedCount,
      totalDiscountGiven: new Decimal(result._sum.discountAmount?.toString() ?? '0'),
    };
  }
}
