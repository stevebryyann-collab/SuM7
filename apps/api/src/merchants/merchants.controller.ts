import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { UpsertMerchantSchema, type UpsertMerchantInput } from '@b2b/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { InternalSecretGuard } from './guards/internal-secret.guard';
import { MerchantsService, type MerchantUpsertResult } from './merchants.service';

/**
 * First-party internal API for merchant provisioning. Not part of the public
 * merchant/buyer surface: every route is guarded by InternalSecretGuard
 * (X-Internal-Secret) and is meant to be reached only server-to-server.
 *
 * `POST /internal/merchants/upsert` is called by the web app's NextAuth callback
 * after a Shopify OAuth sign-in to provision/refresh the merchant + owner user.
 */
@Controller('internal/merchants')
@UseGuards(InternalSecretGuard)
export class MerchantsController {
  constructor(private readonly merchants: MerchantsService) {}

  @Post('upsert')
  @HttpCode(HttpStatus.OK)
  upsert(
    @Body(new ZodValidationPipe(UpsertMerchantSchema)) body: UpsertMerchantInput,
  ): Promise<MerchantUpsertResult> {
    return this.merchants.upsert(body);
  }
}
