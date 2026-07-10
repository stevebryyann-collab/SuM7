'use client';

import { SignUp } from '@clerk/nextjs';

/**
 * Clerk buyer sign-up widget. Clerk handles all credential collection, email
 * verification and brute-force protection — we never see a password. After
 * signup the buyer is authenticated (but not yet approved) and is sent to the
 * wholesale application. Thin client component so the page can be a server
 * component that fetches white-label branding.
 */
export function SignUpCard(): JSX.Element {
  return (
    <SignUp
      routing="path"
      path="/buyer-signup"
      signInUrl="/buyer-login"
      forceRedirectUrl="/portal/apply"
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
