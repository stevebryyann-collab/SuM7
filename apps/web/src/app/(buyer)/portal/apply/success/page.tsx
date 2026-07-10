'use client';

import { useEffect, useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { CheckCircle2 } from 'lucide-react';
import type { ApplicationStatusDto } from '@b2b/shared/types';
import { buyerFetch } from '@/lib/api/buyer';

/**
 * Post-submission confirmation. Reached by `router.push` from the apply form.
 * Pulls the freshly-created application (company + merchant branding) from
 * `GET /buyer/application-status` and the buyer's email from the Clerk session.
 */
export default function ApplySuccessPage(): JSX.Element {
  const { user } = useUser();
  const [status, setStatus] = useState<ApplicationStatusDto | null>(null);

  useEffect(() => {
    let active = true;
    buyerFetch<ApplicationStatusDto>('/buyer/application-status')
      .then((result) => {
        if (active) setStatus(result);
      })
      .catch(() => {
        /* Branding is best-effort; the confirmation still renders without it. */
      });
    return () => {
      active = false;
    };
  }, []);

  const merchantName = status?.merchantDisplayName ?? 'the merchant';
  const companyName = status?.companyName ?? 'your business';
  const email = user?.primaryEmailAddress?.emailAddress ?? 'your email';
  const contactEmail = status?.contactEmail;

  return (
    <div className="panel mx-auto max-w-lg p-8 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center">
        <CheckCircle2 className="h-12 w-12 text-success" />
      </div>
      <h2 className="text-lg font-semibold text-text-primary">Application submitted</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-text-secondary">
        Your trade account application for {companyName} has been received by {merchantName}. You&apos;ll hear
        back at {email} within 1 business day.
      </p>
      {contactEmail ? (
        <p className="mt-4 text-sm text-text-secondary">
          Questions?{' '}
          <a href={`mailto:${contactEmail}`} className="text-accent">
            Contact {merchantName}
          </a>
        </p>
      ) : null}
    </div>
  );
}
