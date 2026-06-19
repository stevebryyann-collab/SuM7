import { type FullConfig } from '@playwright/test';

/**
 * Global setup. Runs once before the suite.
 *
 * In a full environment this would mint authenticated storage states (a merchant
 * NextAuth session and an approved-buyer Clerk session) and seed deterministic
 * fixtures via the API. Those require live Shopify/Clerk credentials and a
 * seeded database, which are provided as CI secrets. When they are absent the
 * setup is a no-op so the unauthenticated specs (login redirects, public auth
 * pages) still run.
 */
async function globalSetup(_config: FullConfig): Promise<void> {
  const hasAuthFixtures =
    !!process.env.E2E_MERCHANT_SESSION_TOKEN && !!process.env.E2E_BUYER_CLERK_TOKEN;

  if (!hasAuthFixtures) {
    // eslint-disable-next-line no-console
    console.warn(
      '[e2e] Auth fixtures not provided (E2E_MERCHANT_SESSION_TOKEN / E2E_BUYER_CLERK_TOKEN); ' +
        'running unauthenticated specs only.',
    );
    return;
  }

  // Authenticated storage states would be persisted here, e.g.:
  //   await fs.writeFile('tests/e2e/.auth/merchant.json', JSON.stringify(merchantState));
  //   await fs.writeFile('tests/e2e/.auth/buyer.json', JSON.stringify(buyerState));
}

export default globalSetup;
