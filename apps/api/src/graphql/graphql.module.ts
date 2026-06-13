import { Module } from '@nestjs/common';
import { GraphQLModule as NestGraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import type { Request } from 'express';
import { StatusResolver } from './status.resolver';

/**
 * Apollo (code-first) GraphQL gateway for the merchant admin dashboard. The
 * schema is generated in-memory from resolver decorators. Introspection and the
 * landing page are disabled outside development.
 */
@Module({
  imports: [
    NestGraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,
      sortSchema: true,
      playground: false,
      introspection: process.env.NODE_ENV !== 'production',
      path: '/graphql',
      context: ({ req }: { req: Request }) => ({ req }),
    }),
  ],
  providers: [StatusResolver],
})
export class GraphQLModule {}
