import { SetMetadata } from '@nestjs/common';
import type { MerchantRole } from '@b2b/shared';

/** Metadata key under which {@link Roles} stores the allowed merchant roles. */
export const ROLES_METADATA_KEY = 'merchant_roles';

/**
 * Restricts a merchant route to one or more merchant-user roles. Used together
 * with {@link MerchantSessionGuard} (which resolves `request.merchant.role`) and
 * {@link RolesGuard}, which enforces the metadata. With no `@Roles` decorator a
 * route is open to any authenticated merchant role.
 *
 *   @UseGuards(MerchantSessionGuard, RolesGuard)
 *   @Roles('owner', 'admin')
 */
export const Roles = (...roles: MerchantRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_METADATA_KEY, roles);
