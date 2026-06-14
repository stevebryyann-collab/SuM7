/**
 * Development seed. Idempotent: re-running upserts the same fixtures.
 * NEVER run against production (guarded below).
 */
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEV_PASSWORD = 'Password123!';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed a production database');
  }

  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 12);

  // A placeholder encrypted Shopify token (v1 envelope shape). Replaced by the
  // real OAuth flow; here only so the NOT NULL column is satisfiable.
  const placeholderEncrypted = `v1:${Buffer.from(randomUUID()).toString('base64')}:${Buffer.from(
    randomUUID(),
  ).toString('base64')}:${Buffer.from('seed').toString('base64')}`;

  const merchant = await prisma.merchant.upsert({
    where: { shopifyDomain: 'demo-fashion.myshopify.com' },
    update: {},
    create: {
      shopifyDomain: 'demo-fashion.myshopify.com',
      shopifyAccessToken: placeholderEncrypted,
      shopifyAccessTokenKeyVersion: 1,
      shopifyStoreId: 'gid://shopify/Shop/1',
      subscriptionTier: 'growth',
      gmvMonthKey: '0000-00',
      isActive: true,
    },
  });

  const owner = await prisma.merchantUser.upsert({
    where: { merchantId_email: { merchantId: merchant.id, email: 'owner@demo-fashion.test' } },
    update: {},
    create: {
      merchantId: merchant.id,
      clerkUserId: 'user_seed_owner_demo_fashion',
      email: 'owner@demo-fashion.test',
      role: 'owner',
      firstName: 'Dana',
      lastName: 'Merchant',
      isActive: true,
    },
  });

  const tier = await prisma.pricingTier.upsert({
    // No natural unique key beyond id; use a deterministic find-or-create.
    where: { id: (await findTierId(merchant.id)) ?? randomUUID() },
    update: { name: 'Wholesale 30%' },
    create: {
      merchantId: merchant.id,
      name: 'Wholesale 30%',
      type: 'percentage_off',
      baseDiscountPct: '30.00',
      isDefault: true,
      priority: 100,
      isActive: true,
    },
  });

  const buyer = await prisma.buyer.upsert({
    where: { email: 'buyer@boutique.test' },
    update: {},
    create: {
      email: 'buyer@boutique.test',
      clerkUserId: 'user_seed_buyer_boutique',
      passwordHash,
      companyName: 'Uptown Boutique LLC',
      businessType: 'Apparel Retailer',
      emailVerifiedAt: new Date(),
    },
  });

  await prisma.merchantBuyerRelationship.upsert({
    where: { merchantId_buyerId: { merchantId: merchant.id, buyerId: buyer.id } },
    update: { approvalStatus: 'approved', pricingTierId: tier.id },
    create: {
      merchantId: merchant.id,
      buyerId: buyer.id,
      pricingTierId: tier.id,
      paymentTerms: 'net30',
      creditLimit: '50000.00',
      approvalStatus: 'approved',
      approvedBy: owner.id,
      approvedAt: new Date(),
    },
  });

  // eslint-disable-next-line no-console
  console.log('Seed complete:', {
    merchant: merchant.shopifyDomain,
    owner: owner.email,
    buyer: buyer.email,
    devPassword: DEV_PASSWORD,
  });
}

/** Find an existing default pricing tier for the merchant, if any. */
async function findTierId(merchantId: string): Promise<string | null> {
  const existing = await prisma.pricingTier.findFirst({
    where: { merchantId, name: 'Wholesale 30%' },
    select: { id: true },
  });
  return existing?.id ?? null;
}

main()
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
