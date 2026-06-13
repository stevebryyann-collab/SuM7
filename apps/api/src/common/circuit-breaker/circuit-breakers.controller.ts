import { Controller, Get } from '@nestjs/common';
import { CircuitBreakerFactory } from './circuit-breaker.factory';

type BreakerState = 'open' | 'half-open' | 'closed';

interface BreakerSnapshot {
  name: string;
  state: BreakerState;
  stats: {
    fires: number;
    successes: number;
    failures: number;
    fallbacks: number;
    timeouts: number;
  };
}

/**
 * Internal observability endpoint exposing live circuit-breaker state. No auth
 * (mounted under /health, intended for internal probes / dashboards only — keep
 * it off the public ingress). Reports every breaker the factory has created.
 */
@Controller('health/circuit-breakers')
export class CircuitBreakersController {
  constructor(private readonly factory: CircuitBreakerFactory) {}

  @Get()
  list(): { breakers: BreakerSnapshot[] } {
    const breakers = this.factory.getAll().map<BreakerSnapshot>((breaker) => ({
      name: breaker.name,
      state: breaker.opened ? 'open' : breaker.halfOpen ? 'half-open' : 'closed',
      stats: {
        fires: breaker.stats.fires,
        successes: breaker.stats.successes,
        failures: breaker.stats.failures,
        fallbacks: breaker.stats.fallbacks,
        timeouts: breaker.stats.timeouts,
      },
    }));
    return { breakers };
  }
}
