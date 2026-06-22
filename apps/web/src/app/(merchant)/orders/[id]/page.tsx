'use client';

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton';
import { OrderDetail } from '@/components/merchant/OrderDetail';
import { useOrder } from '@/hooks/useOrders';

/** Merchant order detail route. Read-only — orders are placed by buyers. */
export default function OrderDetailPage({ params }: { params: { id: string } }): JSX.Element {
  const { data: session } = useSession();
  const query = useOrder('merchant', params.id);

  if (query.isLoading) {
    return <LoadingSkeleton rows={8} columns={[3, 2, 1, 2, 2, 2]} />;
  }

  if (query.isError || !query.data) {
    return (
      <div className="panel p-8 text-center">
        <p className="text-sm text-gray-600">This order could not be found.</p>
        <Link href="/orders" className="mt-3 inline-block">
          <Button variant="default" size="sm">
            Back to orders
          </Button>
        </Link>
      </div>
    );
  }

  return <OrderDetail order={query.data} shopifyDomain={session?.shopifyDomain ?? null} />;
}
