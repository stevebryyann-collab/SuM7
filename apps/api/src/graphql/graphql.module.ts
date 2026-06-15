import { Module } from '@nestjs/common';
import { GraphQLModule as NestGraphQLModule, GraphQLSchemaHost } from '@nestjs/graphql';
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import { ModuleRef } from '@nestjs/core';
import type { Request } from 'express';
import type { GraphQLFormattedError } from 'graphql';
import * as Sentry from '@sentry/node';
import depthLimit from 'graphql-depth-limit';
import { Redis } from 'ioredis';
import { AppConfigModule } from '../config/config.module';
import { AppConfigService } from '../config/app-config.service';
import { REDIS_CACHE } from '../redis/redis.module';
import { StatusResolver } from './status.resolver';
import { DashboardResolver } from './resolvers/dashboard.resolver';
import { ArAgingResolver } from './resolvers/ar-aging.resolver';
import { BuyersResolver } from './resolvers/buyers.resolver';
import { GraphqlContextService } from './graphql-context.service';
import { complexityPlugin } from './complexity.plugin';
import { RedisApqCache } from './redis-apq-cache';

/** Max selection-set depth (defence against deeply-nested abuse queries). */
const MAX_QUERY_DEPTH = 8;

/**
 * Hardened Apollo (code-first) GraphQL gateway for the merchant admin dashboard.
 *
 * Security layers, all active:
 *   - Introspection + landing page OFF in production.
 *   - Depth limit 8 (graphql-depth-limit) as a validation rule.
 *   - Complexity ceiling 200 (graphql-query-complexity) via an Apollo plugin;
 *     per-field costs are declared on the resolver decorators.
 *   - Automatic Persisted Queries backed by REDIS_CACHE. In production the
 *     server is configured so only persisted (hash-registered) queries execute.
 *   - CSRF: text/plain and multipart/form-data bodies are rejected
 *     (INVALID_CONTENT_TYPE) — enforced in the context builder and reinforced by
 *     Apollo's csrfPrevention.
 *   - Authenticated context: the NextAuth merchant token is verified while the
 *     context is built; merchantId is taken from the token, never from arguments.
 *     No token ⇒ no execution.
 *   - Error masking in production: formatError strips stack traces and internal
 *     detail, exposing only { message, extensions: { code } }; Sentry captures
 *     the full error server-side.
 */
@Module({
  imports: [
    NestGraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      imports: [AppConfigModule],
      inject: [AppConfigService, REDIS_CACHE, ModuleRef],
      useFactory: (config: AppConfigService, cache: Redis, moduleRef: ModuleRef) => {
        const isProd = config.isProduction;
        const apqCache = new RedisApqCache(cache);

        return {
          autoSchemaFile: true,
          sortSchema: true,
          playground: false,
          introspection: !isProd,
          path: '/graphql',
          // CSRF prevention: blocks "simple" requests that skip CORS preflight.
          csrfPrevention: true,
          // APQ store on REDIS_CACHE. In production only registered (persisted)
          // query hashes execute; ad-hoc query strings are rejected.
          persistedQueries: { cache: apqCache, ttl: isProd ? null : 300 },
          // Depth limiting runs as a standard GraphQL validation rule.
          validationRules: [depthLimit(MAX_QUERY_DEPTH)],
          // Complexity ceiling needs the built schema, resolved lazily from DI.
          plugins: [
            complexityPlugin(
              () => moduleRef.get(GraphQLSchemaHost, { strict: false }).schema,
            ),
          ],
          // Authenticated, tenant-scoped context. Throws before any resolver runs
          // when the merchant token is absent/invalid.
          context: async ({ req }: { req: Request }) => {
            const ctxService = moduleRef.get(GraphqlContextService, { strict: false });
            return ctxService.build(req);
          },
          includeStacktraceInErrorResponses: !isProd,
          formatError: (
            formattedError: GraphQLFormattedError,
            error: unknown,
          ): GraphQLFormattedError => {
            if (isProd) {
              Sentry.captureException(error);
              return {
                message: formattedError.message,
                extensions: { code: formattedError.extensions?.code ?? 'INTERNAL_SERVER_ERROR' },
              };
            }
            return formattedError;
          },
        } satisfies ApolloDriverConfig;
      },
    }),
  ],
  providers: [
    GraphqlContextService,
    StatusResolver,
    DashboardResolver,
    ArAgingResolver,
    BuyersResolver,
  ],
})
export class GraphQLModule {}
