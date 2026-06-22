import type { MerchantRole } from '@b2b/shared/types';
import 'next-auth';
import 'next-auth/jwt';

/**
 * Module augmentation for the merchant NextAuth session. The buyer side never
 * uses NextAuth (Clerk owns buyer identity), so these fields are merchant-only
 * and optional until a merchant has signed in.
 */
declare module 'next-auth' {
  interface Session {
    merchantId?: string;
    shopifyDomain?: string;
    role?: MerchantRole;
    /** HS256 API token (signed with NEXTAUTH_SECRET) for Bearer auth to NestJS. */
    accessToken?: string;
  }

  interface User {
    /** Transient: set by the signIn callback, consumed by the jwt callback. */
    merchantClaims?: {
      merchantId: string;
      merchantUserId: string;
      shopifyDomain: string;
      role: MerchantRole;
      email: string;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    merchantId?: string;
    merchantUserId?: string;
    shopifyDomain?: string;
    role?: MerchantRole;
    email?: string;
    /** The minted HS256 API token; refreshed on a 7-day sliding window. */
    apiToken?: string;
  }
}
