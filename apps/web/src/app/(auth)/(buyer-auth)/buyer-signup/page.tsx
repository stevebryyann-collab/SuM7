import { getMerchantContextServer } from '@/lib/api/buyer-server';
import { SignUpCard } from './sign-up-card';

/**
 * Buyer signup. Server component: resolves the white-label merchant name from the
 * signed App-Proxy context for the heading, then mounts the Clerk sign-up widget
 * (a client component inside the buyer-auth ClerkProvider). After creating an
 * account the buyer completes their business application at /portal/apply.
 */
export default async function BuyerSignupPage(): Promise<JSX.Element> {
  const context = await getMerchantContextServer();
  const subheading = context
    ? `Join ${context.displayName}'s wholesale program.`
    : 'Create your wholesale account.';

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="text-center">
        <h1 className="text-lg font-semibold text-text-primary">Create your wholesale account</h1>
        <p className="mt-1 text-sm text-text-secondary">
          {subheading} After creating your account, you&apos;ll complete your business application.
        </p>
      </div>
      <SignUpCard />
    </div>
  );
}
