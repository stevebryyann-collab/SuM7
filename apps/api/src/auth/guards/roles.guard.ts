import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { MerchantRole } from '@b2b/shared';
import { ROLES_METADATA_KEY } from '../decorators/roles.decorator';
import type { MerchantAuthenticatedRequest } from './merchant-session.guard';

/**
 * Enforces the `@Roles(...)` metadata against the merchant principal resolved by
 * {@link MerchantSessionGuard}. Must run AFTER MerchantSessionGuard — list it
 * second in `@UseGuards(MerchantSessionGuard, RolesGuard)`. When a handler (or
 * its controller) declares no roles, every authenticated merchant role passes.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<MerchantRole[] | undefined>(
      ROLES_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) {
      return true;
    }

    const req = context.switchToHttp().getRequest<MerchantAuthenticatedRequest>();
    const role = req.merchant?.role;
    if (!role || !required.includes(role)) {
      throw new ForbiddenException({
        code: 'INSUFFICIENT_ROLE',
        message: `This action requires one of: ${required.join(', ')}`,
      });
    }
    return true;
  }
}
