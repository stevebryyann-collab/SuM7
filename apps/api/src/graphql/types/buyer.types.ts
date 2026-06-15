import { Field, Int, ObjectType } from '@nestjs/graphql';

/** A buyer row in the merchant admin list, with per-buyer aggregates. */
@ObjectType({ description: 'A merchant buyer with aggregate order/AR metrics.' })
export class BuyerNode {
  @Field(() => String)
  buyerId!: string;

  @Field(() => String)
  companyName!: string;

  @Field(() => String)
  email!: string;

  @Field(() => String, { description: 'pending | approved | rejected | suspended' })
  approvalStatus!: string;

  @Field(() => String, { nullable: true })
  pricingTierName!: string | null;

  @Field(() => String, { description: 'immediate | net15 | net30 | net60 | net90' })
  paymentTerms!: string;

  @Field(() => String, { nullable: true })
  creditLimit!: string | null;

  @Field(() => Int)
  orderCount!: number;

  @Field(() => String, { description: 'Outstanding (unpaid, non-void) invoice total.' })
  outstandingInvoiceTotal!: string;

  @Field(() => String, { nullable: true, description: 'ISO timestamp of the last order.' })
  lastOrderAt!: string | null;

  @Field(() => String, { description: 'ISO timestamp the relationship was created.' })
  createdAt!: string;
}

/** Relay-style page metadata. */
@ObjectType({ description: 'Relay cursor pagination metadata.' })
export class PageInfo {
  @Field(() => Boolean)
  hasNextPage!: boolean;

  @Field(() => String, { nullable: true, description: 'Opaque cursor for the next page.' })
  endCursor!: string | null;
}

/** Relay edge wrapping a {@link BuyerNode}. */
@ObjectType({ description: 'A buyer edge in a Relay connection.' })
export class BuyerEdge {
  @Field(() => String, { description: 'Opaque cursor for this edge.' })
  cursor!: string;

  @Field(() => BuyerNode)
  node!: BuyerNode;
}

/** Relay connection over buyers. */
@ObjectType({ description: 'A Relay connection of merchant buyers.' })
export class BuyerConnection {
  @Field(() => [BuyerEdge])
  edges!: BuyerEdge[];

  @Field(() => PageInfo)
  pageInfo!: PageInfo;
}
