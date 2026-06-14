import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';

/**
 * Global transactional email (Resend, circuit-breaker wrapped). Injected by the
 * invoice workers and any future notification flow. Depends on the global
 * CircuitBreaker and Config modules.
 */
@Global()
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
