'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton';
import { PageContainer } from '@/components/merchant/PageLayout';
import { InvoiceDetail } from '@/components/merchant/InvoiceDetail';
import { useInvoice } from '@/hooks/useInvoices';

/** Merchant invoice detail route — PDF preview, status timeline, lifecycle actions. */
export default function InvoiceDetailPage({ params }: { params: { id: string } }): JSX.Element {
  const query = useInvoice(params.id);

  if (query.isLoading) {
    return (
      <PageContainer>
        <LoadingSkeleton rows={8} columns={[3, 2, 2, 1, 1, 2]} />
      </PageContainer>
    );
  }

  if (query.isError || !query.data) {
    return (
      <PageContainer>
        <div className="panel p-8 text-center">
          <p className="text-sm text-text-secondary">This invoice could not be found.</p>
          <Link href="/invoices" className="mt-3 inline-block">
            <Button variant="secondary" size="sm">
              Back to invoices
            </Button>
          </Link>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <InvoiceDetail invoice={query.data} />
    </PageContainer>
  );
}
