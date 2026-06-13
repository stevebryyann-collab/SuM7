import NextAuth from 'next-auth';
import { authOptions } from '@/lib/auth-options';

/**
 * NextAuth route handler for the App Router. Exposes GET/POST at
 * /api/auth/* (sign-in, callback, session, csrf, signout).
 */
const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
