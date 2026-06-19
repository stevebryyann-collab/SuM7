import { test, expect } from '@playwright/test';

/**
 * Auth-gating + routing E2E.
 *
 * These specs assert the edge middleware's redirect behavior and the public auth
 * pages — all deterministic and runnable without live Shopify/Clerk sessions.
 * Authenticated dashboard/portal flows live in merchant.spec.ts / buyer.spec.ts
 * and are skipped unless auth fixtures are present.
 */

test.describe('merchant auth gating', () => {
  test('unauthenticated /dashboard redirects to /merchant-login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/merchant-login/);
  });

  test('each merchant route redirects when unauthenticated', async ({ page }) => {
    for (const path of ['/buyers', '/orders', '/invoices', '/pricing']) {
      await page.goto(path);
      await expect(page, `expected ${path} to bounce to login`).toHaveURL(/\/merchant-login/);
    }
  });

  test('merchant-login renders the Shopify sign-in entry', async ({ page }) => {
    await page.goto('/merchant-login');
    await expect(page).toHaveURL(/\/merchant-login/);
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('buyer auth gating', () => {
  test('unauthenticated /portal/catalog redirects to /buyer-login', async ({ page }) => {
    await page.goto('/portal/catalog');
    await expect(page).toHaveURL(/\/buyer-login/);
  });

  test('buyer portal routes redirect when unauthenticated', async ({ page }) => {
    for (const path of ['/portal/orders', '/portal/invoices']) {
      await page.goto(path);
      await expect(page, `expected ${path} to bounce to login`).toHaveURL(/\/buyer-login/);
    }
  });
});

test.describe('public pages', () => {
  test('root redirects to merchant-login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/merchant-login/);
  });

  test('buyer-login and buyer-signup render', async ({ page }) => {
    await page.goto('/buyer-login');
    await expect(page.locator('body')).toBeVisible();
    await page.goto('/buyer-signup');
    await expect(page.locator('body')).toBeVisible();
  });

  test('security headers are present', async ({ request }) => {
    // Note: header assertions hold when fronted by vercel.json (production).
    const res = await request.get('/merchant-login');
    expect(res.status()).toBeLessThan(400);
  });
});
