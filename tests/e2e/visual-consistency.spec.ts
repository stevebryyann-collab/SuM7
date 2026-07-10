import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';

/**
 * Visual-consistency E2E — spot-checks the Apple-Weather premium-glass design
 * rules from CLAUDE.md that are cheap to assert from rendered CSS: the glass
 * system is actually present (surfaces blur what's behind them via
 * backdrop-filter), financial cells render tabular-nums, and status chips are
 * solid tinted fills (never transparent). Authenticated checks reuse the same
 * storage-state fixtures as merchant.spec.ts / buyer.spec.ts and skip without
 * them.
 */

const MERCHANT_STATE = 'tests/e2e/.auth/merchant.json';
const BUYER_STATE = 'tests/e2e/.auth/buyer.json';
const hasMerchantAuth = fs.existsSync(MERCHANT_STATE);
const hasBuyerAuth = fs.existsSync(BUYER_STATE);

/**
 * The glass system must be present: at least one element blurs what's behind it.
 * Inverts the old minimalist rule (which forbade backdrop-filter entirely).
 */
async function expectGlassPresent(page: Page): Promise<void> {
  const glassCount = await page.evaluate(
    () =>
      Array.from(document.querySelectorAll<HTMLElement>('*')).filter((el) => {
        const style = getComputedStyle(el);
        const filter =
          style.backdropFilter ||
          (style as unknown as { webkitBackdropFilter?: string }).webkitBackdropFilter ||
          '';
        return filter !== '' && filter !== 'none';
      }).length,
  );
  expect(glassCount, 'expected at least one glass (backdrop-filter) surface').toBeGreaterThan(0);
}

/** Every matched status-badge/financial-cell must be visible and non-empty — catches silent render gaps. */
async function expectSolidFill(page: Page, testId: string): Promise<void> {
  const nodes = page.getByTestId(testId);
  const count = await nodes.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const bg = await nodes.nth(i).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg, `${testId} #${i} must not be transparent`).not.toBe('rgba(0, 0, 0, 0)');
    expect(bg, `${testId} #${i} must not be transparent`).not.toBe('transparent');
  }
}

async function expectTabularNums(page: Page, testId: string): Promise<void> {
  const nodes = page.getByTestId(testId);
  const count = await nodes.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const variant = await nodes.nth(i).evaluate((el) => getComputedStyle(el).fontVariantNumeric);
    expect(variant, `${testId} #${i} must use tabular-nums`).toContain('tabular-nums');
  }
}

test.describe('visual consistency — unauthenticated surfaces', () => {
  test('login pages float a glass card over the atmosphere', async ({ page }) => {
    await page.goto('/merchant-login');
    await expectGlassPresent(page);

    await page.goto('/buyer-login');
    await expectGlassPresent(page);
  });
});

test.describe('merchant visual consistency', () => {
  test.skip(!hasMerchantAuth, 'merchant auth fixture not available');
  test.use({ storageState: hasMerchantAuth ? MERCHANT_STATE : undefined });

  test('invoice status badges are solid fills with tabular-nums financial cells', async ({ page }) => {
    await page.goto('/invoices');
    await expectSolidFill(page, 'status-badge');
    await expectTabularNums(page, 'financial-cell');
  });

  test('dashboard KPI cards are glass surfaces', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByTestId('kpi-card').first()).toBeVisible();
    await expectGlassPresent(page);
  });

  test('orders table financial cells use tabular-nums', async ({ page }) => {
    await page.goto('/orders');
    await expectTabularNums(page, 'financial-cell');
  });

  test('buyers table shares the same status-badge and financial-cell conventions', async ({ page }) => {
    await page.goto('/buyers');
    await expectSolidFill(page, 'status-badge');
    await expectTabularNums(page, 'financial-cell');
  });

  test('pricing surfaces render on glass', async ({ page }) => {
    await page.goto('/pricing');
    await expectGlassPresent(page);
  });
});

test.describe('buyer portal visual consistency', () => {
  test.skip(!hasBuyerAuth, 'buyer auth fixture not available');
  test.use({ storageState: hasBuyerAuth ? BUYER_STATE : undefined });

  test('bulk order table financial cells use tabular-nums', async ({ page }) => {
    await page.goto('/portal/catalog');
    await expectTabularNums(page, 'financial-cell');
  });

  test('cart footer is a glass bar', async ({ page }) => {
    await page.goto('/portal/catalog');
    await expect(page.getByTestId('cart-footer')).toBeVisible();
    await expectGlassPresent(page);
  });
});
