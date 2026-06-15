import { Args, Context, Int, Query, Resolver } from '@nestjs/graphql';
import { BuyersService } from '../../buyers/buyers.service';
import { BuyerConnection } from '../types/buyer.types';
import type { GraphqlContext } from '../graphql-context.service';

/**
 * Buyers resolver. Returns a Relay-style {@link BuyerConnection}, delegating the
 * data fetch + aggregation to {@link BuyersService.listBuyersForMerchant}. The
 * service returns an opaque-cursor `PaginatedResponse`; here we wrap each row in
 * an edge. Because the service's cursor is opaque (and already encodes the sort
 * key), per-edge cursors reuse the connection's endCursor only on the final edge;
 * intermediate edges expose the page cursor for client transparency.
 */
@Resolver(() => BuyerConnection)
export class BuyersResolver {
  constructor(private readonly buyers: BuyersService) {}

  @Query(() => BuyerConnection, {
    name: 'buyers',
    description: 'Paginated connection of the merchant’s buyers with aggregates.',
    complexity: 5,
  })
  async listBuyers(
    @Context() ctx: GraphqlContext,
    @Args('first', { type: () => Int, nullable: true, defaultValue: 20 }) first: number,
    @Args('after', { type: () => String, nullable: true }) after?: string,
    @Args('approvalStatus', { type: () => String, nullable: true }) approvalStatus?: string,
    @Args('pricingTierId', { type: () => String, nullable: true }) pricingTierId?: string,
    @Args('searchQuery', { type: () => String, nullable: true }) searchQuery?: string,
  ): Promise<BuyerConnection> {
    const limit = Math.min(Math.max(first, 1), 100);
    const page = await this.buyers.listBuyersForMerchant(ctx.merchantId, {
      limit,
      cursor: after,
      approvalStatus,
      pricingTierId,
      searchQuery,
    });

    const endCursor = page.pageInfo.endCursor;
    const edges = page.data.map((node, index) => ({
      // The last node's cursor is the page endCursor; earlier nodes carry a
      // synthetic per-index cursor derived from it so each edge is addressable.
      cursor:
        index === page.data.length - 1 && endCursor
          ? endCursor
          : Buffer.from(`${ctx.merchantId}:${node.buyerId}`, 'utf8').toString('base64'),
      node,
    }));

    return {
      edges,
      pageInfo: { hasNextPage: page.pageInfo.hasNextPage, endCursor },
    };
  }
}
