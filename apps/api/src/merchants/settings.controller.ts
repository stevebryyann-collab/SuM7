import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import {
  UpdateMerchantSettingsSchema,
  type UpdateMerchantSettingsInput,
} from '@b2b/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  MerchantSessionGuard,
  type MerchantAuthenticatedRequest,
} from '../auth/guards/merchant-session.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { MerchantsService, type MerchantSettings } from './merchants.service';

/**
 * Merchant settings surface (`/api/v1/settings`). Any authenticated merchant
 * role may read settings; only owner/admin may update them. invoicePrefix +
 * paymentInstructions affect invoicing; the notification toggles drive owner
 * email alerts.
 */
@Controller('api/v1/settings')
@UseGuards(MerchantSessionGuard, RolesGuard)
export class SettingsController {
  constructor(private readonly merchants: MerchantsService) {}

  @Get()
  getSettings(@Req() req: MerchantAuthenticatedRequest): Promise<MerchantSettings> {
    return this.merchants.getSettings(req.merchant!.merchantId);
  }

  @Put()
  @Roles('owner', 'admin')
  updateSettings(
    @Req() req: MerchantAuthenticatedRequest,
    @Body(new ZodValidationPipe(UpdateMerchantSettingsSchema)) dto: UpdateMerchantSettingsInput,
  ): Promise<MerchantSettings> {
    return this.merchants.updateSettings(req.merchant!.merchantId, dto, req.merchant!.userId);
  }
}
