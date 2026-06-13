import { Query, Resolver } from '@nestjs/graphql';

/**
 * Minimal root resolver so the code-first schema is valid before feature
 * resolvers are registered. Returns a static liveness string.
 */
@Resolver()
export class StatusResolver {
  @Query(() => String, { description: 'API liveness probe for the GraphQL gateway.' })
  apiStatus(): string {
    return 'ok';
  }
}
