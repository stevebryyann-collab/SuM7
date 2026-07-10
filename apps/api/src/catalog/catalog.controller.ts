import { Controller, Get, NotFoundException, Param, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ClerkBuyerGuard, type BuyerAuthenticatedRequest } from '../auth/guards/clerk-buyer.guard';
import { CatalogService, type CatalogPage, type CatalogProduct } from './catalog.service';
import { InventoryService, type InventoryLevel } from './inventory.service';

/** Buyer catalog query — cursor + optional free-text search + page size. */
const CatalogQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
type CatalogQueryInput = z.infer<typeof CatalogQuerySchema>;

/** Inventory query — comma-separated variant IDs (max 200). */
const InventoryQuerySchema = z.object({
  variantIds: z.string().transform((val) => val.split(',').slice(0, 200)),
});
type InventoryQueryInput = z.infer<typeof InventoryQuerySchema>;

/**
 * Buyer-facing catalog HTTP surface.
 *
 *   Buyer portal (Clerk):
 *     GET /buyer/catalog   tier-resolved, cursor-paginated product catalog
 *     GET /buyer/catalog/inventory   batch inventory lookup for variants
 *
 * The buyer's tenant is the merchant resolved by {@link ClerkBuyerGuard} from the
 * App-Proxy cookie — never a client-supplied id. Pricing is resolved server-side
 * against the buyer's pricing tier; the service owns cache stampede + early
 * expiration protection.
 */
@Controller()
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly inventory: InventoryService,
  ) {}

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

  @Get('buyer/catalog/inventory')
  @UseGuards(ClerkBuyerGuard)
  async getInventory(
    @Req() req: BuyerAuthenticatedRequest,
    @Query(new ZodValidationPipe(InventoryQuerySchema)) query: InventoryQueryInput,
  ): Promise<Record<string, InventoryLevel>> {
    const { merchantId } = req.buyer!;

    // For now, pass empty string for encrypted token since inventory service
    // doesn't actually fetch from Shopify yet (placeholder implementation)
    const levels = await this.inventory.getInventoryForVariants(
      merchantId,
      '', // Encrypted token - to be implemented when ShopifyApiService adds getVariant
      query.variantIds,
      req.headers['x-correlation-id'] as string | undefined,
    );

    // Convert Map to plain object for JSON serialization
    return Object.fromEntries(levels);
  }

  /**
   * Single product by Shopify handle, tier-priced for the buyer. Declared AFTER
   * the static `buyer/catalog/inventory` route so that path is never captured by
   * this `:handle` param. Unknown handles resolve to 404 PRODUCT_NOT_FOUND.
   */
  @Get('buyer/catalog/:handle')
  @UseGuards(ClerkBuyerGuard)
  async getProduct(
    @Req() req: BuyerAuthenticatedRequest,
    @Param('handle') handle: string,
  ): Promise<CatalogProduct> {
    const buyer = req.buyer!;
    const product = await this.catalog.getProductByHandle(buyer.buyerId, buyer.merchantId, handle);
    if (!product) {
      throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found' });
    }
    return product;
  }
}
