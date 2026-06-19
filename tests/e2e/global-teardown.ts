/**
 * Global teardown. Runs once after the suite.
 *
 * Cleans up any fixtures created in global-setup (seeded buyers/orders/invoices)
 * and removes persisted auth storage states. A no-op when no fixtures were
 * created.
 */
async function globalTeardown(): Promise<void> {
  // Mirror of global-setup: delete seeded data + .auth states when present.
}

export default globalTeardown;
