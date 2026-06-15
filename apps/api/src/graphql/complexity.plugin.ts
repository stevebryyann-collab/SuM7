import type { ApolloServerPlugin, GraphQLRequestListener } from '@apollo/server';
import { GraphQLError, type GraphQLSchema } from 'graphql';
import {
  fieldExtensionsEstimator,
  getComplexity,
  simpleEstimator,
} from 'graphql-query-complexity';

/** Per-field/operation complexity ceiling for the merchant GraphQL API. */
export const MAX_QUERY_COMPLEXITY = 200;

/**
 * Default per-field cost. The cost taxonomy from the prompt — scalar=1, list=2,
 * nested resolver=5, aggregation=20 — is expressed per field via the
 * `complexity` option on each `@Query`/`@Field` decorator (read by the
 * fieldExtensions estimator). Fields without an explicit cost fall back to this
 * scalar default.
 */
const DEFAULT_FIELD_COST = 1;

/**
 * Apollo plugin that rejects any operation whose estimated complexity exceeds
 * {@link MAX_QUERY_COMPLEXITY}. Complexity is computed at `didResolveOperation`
 * (after parse + validate) using the field-extension costs first, then a scalar
 * fallback. The schema is read lazily so the plugin can be constructed before
 * the code-first schema has finished building.
 */
export function complexityPlugin(getSchema: () => GraphQLSchema): ApolloServerPlugin {
  return {
    async requestDidStart(): Promise<GraphQLRequestListener<Record<string, unknown>>> {
      return {
        async didResolveOperation({ request, document }): Promise<void> {
          const complexity = getComplexity({
            schema: getSchema(),
            query: document,
            variables: request.variables,
            operationName: request.operationName ?? undefined,
            estimators: [
              fieldExtensionsEstimator(),
              simpleEstimator({ defaultComplexity: DEFAULT_FIELD_COST }),
            ],
          });

          if (complexity > MAX_QUERY_COMPLEXITY) {
            throw new GraphQLError(
              `Query is too complex: ${complexity}. Maximum allowed is ${MAX_QUERY_COMPLEXITY}.`,
              { extensions: { code: 'QUERY_TOO_COMPLEX' } },
            );
          }
        },
      };
    },
  };
}
