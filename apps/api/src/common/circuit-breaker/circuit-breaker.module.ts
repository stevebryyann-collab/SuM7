import { Global, Module } from '@nestjs/common';
import { CircuitBreakerFactory } from './circuit-breaker.factory';
import { CircuitBreakersController } from './circuit-breakers.controller';

/**
 * Global circuit-breaker infrastructure. Any outbound-integration service
 * (Shopify, Stripe, Resolve, Resend) injects {@link CircuitBreakerFactory} to
 * wrap its calls; breaker state is surfaced at /health/circuit-breakers.
 */
@Global()
@Module({
  providers: [CircuitBreakerFactory],
  controllers: [CircuitBreakersController],
  exports: [CircuitBreakerFactory],
})
export class CircuitBreakerModule {}
