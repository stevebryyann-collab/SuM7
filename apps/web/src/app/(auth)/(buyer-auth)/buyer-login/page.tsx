'use client';

import { SignIn } from '@clerk/nextjs';

/**
 * Buyer login. Clerk owns buyer credentials entirely — we NEVER collect or store
 * buyer passwords (no NextAuth here). Styled with the design-system appearance so
 * it matches the rest of the portal: solid surfaces, single accent, no glassy or
 * gradient chrome.
 */
export default function BuyerLoginPage(): JSX.Element {
  return (
    <SignIn
      routing="path"
      path="/buyer-login"
      signUpUrl="/buyer-signup"
      forceRedirectUrl="/portal/catalog"
      appearance={{
        variables: {
          colorPrimary: '#2563eb',
          colorBackground: '#ffffff',
          colorText: '#111827',
          borderRadius: '0.5rem',
          fontFamily: 'inherit',
        },
        elements: {
          card: 'shadow-sm border border-gray-200',
          headerSubtitle: 'text-gray-500',
          formButtonPrimary: 'bg-accent border border-accent-dark hover:brightness-100 active:brightness-95 normal-case',
          footerActionLink: 'text-accent',
        },
      }}
    />
  );
}
