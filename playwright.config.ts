import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E config for the web app (merchant admin + buyer portal).
 *
 * The dev server is started automatically (reusing an already-running one
 * locally). Auth-gated flows rely on storage states produced by global setup;
 * unauthenticated flows (login redirects, the public auth pages) run directly.
 *
 * Env:
 *   PLAYWRIGHT_BASE_URL   target origin (default http://localhost:3000)
 *   CI                    enables retries + single worker
 */
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['html', { open: 'never' }], ['github']]
    : [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm --filter @b2b/web start',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
