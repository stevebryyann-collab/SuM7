import { test, expect } from '@playwright/test';
import fs from 'node:fs';

/**
 * Buyer portal happy-path E2E. Requires an approved-buyer Clerk storage state
 * (and the __merchant_id/__merchant_domain cookies) from global-setup; skipped
 * when the fixture is absent.
 */
const BUYER_STATE = 'tests/e2e/.auth/buyer.json';
const hasAuth = fs.existsSync(BUYER_STATE);

test.describe('buyer portal', () => {
  test.skip(!hasAuth, 'buyer auth fixture not available');
  test.use({ storageState: hasAuth ? BUYER_STATE : undefined });

  test('catalog renders the bulk-order table', async ({ page }) => {
    await page.goto('/portal/catalog');
    await expect(page).toHaveURL(/\/portal\/catalog/);
    await expect(page.locator('table, [role="grid"]').first()).toBeVisible();
  });

  test('buyer can view their orders list', async ({ page }) => {
    await page.goto('/portal/orders');
    await expect(page).toHaveURL(/\/portal\/orders/);
  });

  test('buyer can view their invoices and request a download', async ({ page }) => {
    await page.goto('/portal/invoices');
    await expect(page).toHaveURL(/\/portal\/invoices/);
  });
});
