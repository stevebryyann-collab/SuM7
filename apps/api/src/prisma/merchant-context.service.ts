import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';

/**
 * The tenant context that drives PostgreSQL Row-Level Security. Exactly one of
 * the two states is meaningful per query:
 *   - merchantId set, bypassRls false → normal tenant-scoped access
 *   - bypassRls true                  → trusted system path (workers, cron)
 */
export interface MerchantContext {
  merchantId: string | null;
  bypassRls: boolean;
}

@Injectable()
export class MerchantContextService {
  private readonly storage = new AsyncLocalStorage<MerchantContext>();

  /** Run `fn` scoped to a specific merchant (RLS enforced). */
  run<T>(merchantId: string, fn: () => T): T {
    return this.storage.run({ merchantId, bypassRls: false }, fn);
  }

  /**
   * Run `fn` as the system: RLS is bypassed via the app.bypass_rls GUC. Use ONLY
   * for webhook workers, scheduled jobs, internal health checks, and the
   * cross-merchant buyer-auth lookups.
   */
  runAsSystem<T>(fn: () => T): T {
    return this.storage.run({ merchantId: null, bypassRls: true }, fn);
  }

  /** The merchant id in scope, or null when none / system context. */
  getCurrentMerchantId(): string | null {
    return this.storage.getStore()?.merchantId ?? null;
  }

  /** Whether the current context bypasses RLS. */
  isBypass(): boolean {
    return this.storage.getStore()?.bypassRls ?? false;
  }

  /** The full context object, or undefined if no context is active. */
  getContext(): MerchantContext | undefined {
    return this.storage.getStore();
  }
}
