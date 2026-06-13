import {
  CallHandler,
  ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { MerchantContextService } from '../../prisma/merchant-context.service';
import type { MerchantAuthenticatedRequest } from '../../auth/guards/merchant-session.guard';

/**
 * Opens the RLS AsyncLocalStorage scope for the duration of the request handler.
 * Runs AFTER guards (so `request.merchant` is populated) and wraps
 * `next.handle()` so every Prisma query in the handler — and the RLS middleware
 * that reads the context — sees the correct tenant.
 *
 * Requests without a merchant session (e.g. buyer or webhook routes) pass
 * through untouched; those paths set their own context explicitly.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly merchantContext: MerchantContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<MerchantAuthenticatedRequest>();
    const merchantId = req.merchant?.merchantId;
    if (!merchantId) {
      return next.handle();
    }
    return this.merchantContext.run(merchantId, () => next.handle());
  }
}
