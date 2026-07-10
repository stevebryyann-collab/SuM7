'use client';

import { Compass } from 'lucide-react';
import { PageContainer } from '@/components/merchant/PageLayout';
import { EmptyState } from '@/components/shared/EmptyState';

/**
 * Merchant route-group 404. Triggered by `notFound()` in a merchant page (e.g. a
 * buyer / order / invoice detail whose id does not resolve for this tenant). It
 * renders inside the sidebar chrome as a calm empty state pointing back to the
 * dashboard — never a bare Next.js default.
 *
 * Client Component: it hands a lucide icon to the (client) EmptyState, which
 * cannot cross a server→client boundary as a prop. Marking the boundary client
 * also keeps it out of the RSC payload of every sibling page in the segment.
 */
export default function MerchantNotFound(): JSX.Element {
  return (
    <PageContainer>
      <div className="panel mx-auto my-8 max-w-lg">
        <EmptyState
          icon={Compass}
          title="We couldn't find that page"
          description="The record may have been removed, or the link is out of date. Let's get you back on track."
          action={{ label: 'Back to dashboard', href: '/dashboard' }}
        />
      </div>
    </PageContainer>
  );
}
