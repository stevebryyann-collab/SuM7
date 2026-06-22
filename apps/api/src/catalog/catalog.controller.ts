import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ClerkBuyerGuard, type BuyerAuthenticatedRequest } from '../auth/guards/clerk-buyer.guard';
import { CatalogService, type CatalogPage } from './catalog.service';

/** Buyer catalog query — cursor + optional free-text search + page size. */
const CatalogQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
type CatalogQueryInput = z.infer<typeof CatalogQuerySchema>;

/**
 * Buyer-facing catalog HTTP surface.
 *
 *   Buyer portal (Clerk):
 *     GET /buyer/catalog   tier-resolved, cursor-paginated product catalog
 *
 * The buyer's tenant is the merchant resolved by {@link ClerkBuyerGuard} from the
 * App-Proxy cookie — never a client-supplied id. Pricing is resolved server-side
 * against the buyer's pricing tier; the service owns cache stampede + early
 * expiration protection.
 */
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('buyer/catalog')
  @UseGuards(ClerkBuyerGuard)
  getCatalog(
    @Req() req: BuyerAuthenticatedRequest,
    @Query(new ZodValidationPipe(CatalogQuerySchema)) query: CatalogQueryInput,
  ): Promise<CatalogPage> {
    const buyer = req.buyer!;
    return this.catalog.getCatalogForBuyer(buyer.buyerId, buyer.merchantId, {
      cursor: query.cursor ?? null,
      search: query.search,
      limit: query.limit,
    });
  }
}
