import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { MerchantContextService, type MerchantContext } from './merchant-context.service';

/** A Prisma transaction client (the subset available inside $transaction). */
export type PrismaTransaction = Prisma.TransactionClient;

const STATEMENT_TIMEOUT_MS = 5000;
const IDLE_IN_TX_TIMEOUT_MS = 10000;
const SLOW_QUERY_MS = 100;

/**
 * Quote a UUID for safe inlining into a `SET` statement. UUIDs are validated
 * upstream, but we re-validate here so a malformed value can never reach SQL.
 */
function quoteMerchantId(merchantId: string): string {
  if (!/^[0-9a-fA-F-]{36}$/.test(merchantId)) {
    throw new Error(`Refusing to set non-uuid merchant context: ${merchantId}`);
  }
  return `'${merchantId}'`;
}

@Injectable()
export class PrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, 'query'>
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(private readonly merchantContext: MerchantContextService) {
    super({
      // PgBouncer-friendly: no prepared statements, bounded pool.
      datasourceUrl: process.env.DATABASE_URL,
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'stdout', level: 'error' },
        { emit: 'stdout', level: 'warn' },
      ],
    });

    // Per-query RLS GUC propagation. See class docstring for the PgBouncer
    // caveat; writes that must be transactional use withTenantTransaction().
    this.$use(async (params, next) => this.applyRlsContext(params, next));
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    // Connection-level safety timeouts. Effective on the connection they run on;
    // for pooled deployments also set via the connection string `options`.
    await this.$executeRawUnsafe(`SET statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    await this.$executeRawUnsafe(
      `SET idle_in_transaction_session_timeout = ${IDLE_IN_TX_TIMEOUT_MS}`,
    );

    if (process.env.NODE_ENV === 'development') {
      this.$on('query', (event: Prisma.QueryEvent) => {
        if (event.duration >= SLOW_QUERY_MS) {
          this.logger.warn(`Slow query (${event.duration}ms): ${event.query}`);
        }
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Middleware that pushes the active tenant context into the session GUC before
   * each query. This is correct against a direct Postgres connection or PgBouncer
   * in *session* pooling mode. Under PgBouncer *transaction* pooling, prefer
   * {@link withTenantTransaction}, which SET LOCALs inside one interactive
   * transaction so the GUC and the query share a single physical connection.
   */
  private async applyRlsContext(
    params: Prisma.MiddlewareParams,
    next: (params: Prisma.MiddlewareParams) => Promise<unknown>,
  ): Promise<unknown> {
    const ctx = this.merchantContext.getContext();
    if (!ctx) {
      // No context: RLS fails closed (policies match no row). We still proceed
      // so that non-tenant tables (e.g. buyers, idempotency_keys) remain usable.
      return next(params);
    }
    await this.setGuc(this, ctx, /* local */ false);
    return next(params);
  }

  /** Emit the appropriate SET / SET LOCAL statements for a context. */
  private async setGuc(
    client: PrismaClient | PrismaTransaction,
    ctx: MerchantContext,
    local: boolean,
  ): Promise<void> {
    const scope = local ? 'LOCAL ' : '';
    if (ctx.bypassRls) {
      await client.$executeRawUnsafe(`SET ${scope}app.bypass_rls = 'true'`);
    } else if (ctx.merchantId) {
      await client.$executeRawUnsafe(
        `SET ${scope}app.current_merchant_id = ${quoteMerchantId(ctx.merchantId)}`,
      );
    }
  }

  /**
   * Production-correct RLS for multi-step writes under transaction pooling.
   * Opens an interactive transaction, SET LOCALs the tenant GUC (so it is scoped
   * to this transaction and this connection), then runs `fn` against the
   * transactional client. Reads the context from MerchantContextService.
   */
  async withTenantTransaction<T>(
    fn: (tx: PrismaTransaction) => Promise<T>,
  ): Promise<T> {
    const ctx = this.merchantContext.getContext();
    if (!ctx) {
      throw new Error('withTenantTransaction called without an active merchant context');
    }
    return this.$transaction(async (tx) => {
      await this.setGuc(tx, ctx, /* local */ true);
      return fn(tx);
    });
  }
}
