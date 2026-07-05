'use client';

import { Compass } from 'lucide-react';
import { EmptyState } from '@/components/shared/EmptyState';

/**
 * Buyer portal 404. Triggered by `notFound()` in a portal page (e.g. an order or
 * product handle that does not resolve for this buyer). Renders inside the buyer
 * header chrome as a calm empty state that points back to the catalog.
 *
 * Client Component: it hands a lucide icon to the (client) EmptyState, which
 * cannot cross a server→client boundary as a prop.
 */
export default function BuyerNotFound(): JSX.Element {
  return (
    <div className="panel mx-auto my-8 max-w-lg">
      <EmptyState
        icon={Compass}
        title="We couldn't find that page"
        description="This item may no longer be available, or the link is out of date. Browse the catalog to keep shopping."
        action={{ label: 'Back to catalog', href: '/portal/catalog' }}
      />
    </div>
  );
}
