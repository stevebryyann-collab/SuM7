import { getMerchantContextServer } from '@/lib/api/buyer-server';
import { SignInCard } from './sign-in-card';

/**
 * Buyer login. Server component: resolves the white-label merchant name from the
 * signed App-Proxy context, renders the branded heading, then mounts the Clerk
 * sign-in widget (a client component inside the buyer-auth ClerkProvider). Clerk
 * owns buyer credentials entirely — we NEVER collect or store buyer passwords.
 */
export default async function BuyerLoginPage(): Promise<JSX.Element> {
  const context = await getMerchantContextServer();
  const heading = context ? `${context.displayName}'s Wholesale Portal` : 'Wholesale Portal';

  return (
    <div className="flex flex-col items-center gap-4">
      <h1 className="text-center text-lg font-semibold text-gray-900">{heading}</h1>
      <SignInCard />
    </div>
  );
}
