import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { timingSafeEqual } from '@b2b/shared';
import { AppConfigService } from '../../config/app-config.service';

const HEADER = 'x-internal-secret';

/**
 * Authenticates server-to-server calls to the `/internal/*` surface by comparing
 * the `X-Internal-Secret` header against INTERNAL_API_SECRET in constant time.
 *
 * This secret is shared only with trusted first-party callers (the web app's
 * NextAuth callback) and never reaches the browser. Constant-time comparison
 * avoids leaking the secret via response-timing.
 */
@Injectable()
export class InternalSecretGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const provided = req.headers[HEADER];
    const secret = this.config.get('INTERNAL_API_SECRET');

    if (typeof provided !== 'string' || !timingSafeEqual(provided, secret)) {
      throw new UnauthorizedException({
        code: 'INVALID_INTERNAL_SECRET',
        message: 'Invalid or missing internal secret',
      });
    }
    return true;
  }
}
