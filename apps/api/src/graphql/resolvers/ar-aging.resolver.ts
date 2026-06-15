import { Context, Query, Resolver } from '@nestjs/graphql';
import { InvoicesService } from '../../invoices/invoices.service';
import { ArAgingType } from '../types/dashboard.types';
import type { GraphqlContext } from '../graphql-context.service';

/**
 * AR aging resolver. Delegates entirely to {@link InvoicesService.getArAging}
 * (the single source of the bucketed CTE); the resolver only adapts the result
 * to the GraphQL object type. Tenant comes from the authenticated context.
 */
@Resolver(() => ArAgingType)
export class ArAgingResolver {
  constructor(private readonly invoices: InvoicesService) {}

  @Query(() => ArAgingType, {
    description: 'Accounts-receivable aging buckets for the merchant.',
    complexity: 20,
  })
  async getArAging(@Context() ctx: GraphqlContext): Promise<ArAgingType> {
    const aging = await this.invoices.getArAging(ctx.merchantId);
    return {
      current: aging.current,
      overdue_1_30: aging.overdue_1_30,
      overdue_31_60: aging.overdue_31_60,
      overdue_61_90: aging.overdue_61_90,
      overdue_90_plus: aging.overdue_90_plus,
    };
  }
}
