'use client';

import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/shared/PageHeader';
import { InvoiceTable } from '@/components/merchant/InvoiceTable';
import { CursorPagination } from '@/components/shared/CursorPagination';
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton';
import { useInvoices } from '@/hooks/useInvoices';
import type { InvoiceSummary } from '@/types/api';

/**
 * Merchant invoices + AR. Honors the `agingBucket` query param the dashboard
 * AR-aging chart links to. Pagination is strictly cursor-based: "page index"
 * here is just how far into the materialized page list we've walked.
 */
function InvoicesView(): JSX.Element {
  const searchParams = useSearchParams();
  const agingBucket = searchParams.get('agingBucket') ?? undefined;
  const [pageIndex, setPageIndex] = useState(0);

  const query = useInvoices({ mode: 'merchant', agingBucket });

  const pages = query.data?.pages ?? [];
  const current = pages[pageIndex];
  const invoices: InvoiceSummary[] = useMemo(() => current?.data ?? [], [current]);

  const goNext = (): void => {
    if (pageIndex < pages.length - 1) {
      setPageIndex((i) => i + 1);
    } else if (query.hasNextPage) {
      void query.fetchNextPage().then(() => setPageIndex((i) => i + 1));
    }
  };

  return (
    <>
      <PageHeader
        title="Invoices"
        description={agingBucket ? `Filtered to aging bucket: ${agingBucket}` : 'Receivables and payment status.'}
      />
      <section className="panel">
        {query.isLoading ? (
          <LoadingSkeleton rows={10} columns={[2, 3, 1, 2, 1, 2]} />
        ) : (
          <>
            <InvoiceTable invoices={invoices} />
            <CursorPagination
              hasPrevious={pageIndex > 0}
              hasNext={pageIndex < pages.length - 1 || query.hasNextPage}
              isLoading={query.isFetchingNextPage}
              onPrevious={() => setPageIndex((i) => Math.max(0, i - 1))}
              onNext={goNext}
              caption={`${invoices.length} on this page`}
            />
          </>
        )}
      </section>
    </>
  );
}

export default function InvoicesPage(): JSX.Element {
  // useSearchParams requires a Suspense boundary in the App Router.
  return (
    <Suspense fallback={<LoadingSkeleton rows={10} columns={[2, 3, 1, 2, 1, 2]} />}>
      <InvoicesView />
    </Suspense>
  );
}
