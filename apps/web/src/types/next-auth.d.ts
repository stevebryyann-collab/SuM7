import type { MerchantRole } from '@b2b/shared';
import 'next-auth';
import 'next-auth/jwt';

/**
 * Augment NextAuth's Session and JWT with the merchant claims the API relies on.
 */
declare module 'next-auth' {
  interface Session {
    merchantId?: string;
    merchantUserId?: string;
    shopifyDomain?: string;
    role?: MerchantRole;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    merchantId?: string;
    merchantUserId?: string;
    shopifyDomain?: string;
    role?: MerchantRole;
  }
}
