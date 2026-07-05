'use client';

import { SignIn } from '@clerk/nextjs';

/**
 * Clerk buyer sign-in widget. Styled with the design-system appearance so it
 * matches the rest of the portal: solid surfaces, single accent, no glassy or
 * gradient chrome. Kept as a thin client component so the page wrapping it can
 * be a server component that fetches white-label branding.
 */
export function SignInCard(): JSX.Element {
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
          card: 'rounded-2xl border border-glass-border bg-glass-strong shadow-glass-lg backdrop-blur-glass',
          headerSubtitle: 'text-text-secondary',
          formButtonPrimary:
            'bg-accent border border-accent-dark hover:brightness-100 active:brightness-95 normal-case',
          footerActionLink: 'text-accent',
        },
      }}
    />
  );
}
