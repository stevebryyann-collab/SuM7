import { Controller, Get, Patch, Body, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ClerkBuyerGuard, type BuyerAuthenticatedRequest } from '../auth/guards/clerk-buyer.guard';
import { MerchantSessionGuard, type MerchantAuthenticatedRequest } from '../auth/guards/merchant-session.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { MerchantsService } from '../merchants/merchants.service';
import { InventoryService } from '../catalog/inventory.service';

const UpdateMerchantSettingsSchema = z.object({
  allowsBackOrders: z.boolean().optional(),
  gtmId: z.string().max(50).optional(),
  ga4Id: z.string().max(50).optional(),
  invoicePrefix: z.string().max(8).optional(),
  paymentInstructions: z.string().max(500).nullable().optional(),
});

export interface PortalConfig {
  merchantName: string;
  gtmId: string | null;
  ga4Id: string | null;
  allowsBackOrders: boolean;
  brandColor?: string;
}

@Controller()
export class MerchantSettingsController {
  constructor(
    private readonly merchants: MerchantsService,
    private readonly inventory: InventoryService,
  ) {}

  @Get('buyer/portal-config')
  @UseGuards(ClerkBuyerGuard)
  async getPortalConfig(@Req() req: BuyerAuthenticatedRequest): Promise<PortalConfig> {
    const { merchantId } = req.buyer!;
    const merchant = await this.merchants.getMerchantConfig(merchantId);

    return {
      merchantName: merchant.shopifyDomain.replace('.myshopify.com', ''),
      gtmId: merchant.gtmId ?? null,
      ga4Id: merchant.ga4Id ?? null,
      allowsBackOrders: merchant.allowsBackOrders ?? false,
    };
  }

  @Patch('merchants/settings')
  @UseGuards(MerchantSessionGuard, RolesGuard)
  @Roles('owner', 'admin')
  async updateSettings(
    @Req() req: MerchantAuthenticatedRequest,
    @Body(new ZodValidationPipe(UpdateMerchantSettingsSchema)) body: z.infer<typeof UpdateMerchantSettingsSchema>,
  ): Promise<void> {
    const { merchantId } = req.merchant!;
    const correlationId = req.headers['x-correlation-id'] as string | undefined;

    await this.merchants.updateMerchantSettings(merchantId, body, correlationId);

    // Invalidate caches if back-order setting changed
    if (body.allowsBackOrders !== undefined) {
      await this.inventory.invalidateMerchantBackOrderCache(merchantId);
    }
  }
}
