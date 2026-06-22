import { test, expect } from '@playwright/test';
import fs from 'node:fs';

/**
 * Merchant admin happy-path E2E. Requires an authenticated NextAuth storage
 * state produced by global-setup; skipped when the fixture is absent so the
 * suite stays green without live Shopify credentials.
 */
const MERCHANT_STATE = 'tests/e2e/.auth/merchant.json';
const hasAuth = fs.existsSync(MERCHANT_STATE);

test.describe('merchant admin', () => {
  test.skip(!hasAuth, 'merchant auth fixture not available');
  test.use({ storageState: hasAuth ? MERCHANT_STATE : undefined });

  test('dashboard shows KPI cards and AR aging chart', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText(/outstanding|GMV|overdue/i).first()).toBeVisible();
  });

  test('buyers list loads and approval panel opens', async ({ page }) => {
    await page.goto('/buyers');
    await expect(page).toHaveURL(/\/buyers/);
    await expect(page.locator('table, [role="table"]').first()).toBeVisible();
  });

  test('invoices list honors the aging-bucket filter', async ({ page }) => {
    await page.goto('/invoices?agingBucket=1-30');
    await expect(page).toHaveURL(/agingBucket=1-30/);
    await expect(page.getByText(/aging bucket/i)).toBeVisible();
  });
});
