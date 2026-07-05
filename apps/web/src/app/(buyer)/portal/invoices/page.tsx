'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Download } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { CursorPagination } from '@/components/shared/CursorPagination';
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton';
import { useInvoices } from '@/hooks/useInvoices';
import { useDownloadInvoice } from '@/hooks/useInvoiceActions';
import { ApiClientError } from '@/lib/api/error';
import { formatDate, formatMoney } from '@/lib/format';
import type { InvoiceSummary } from '@/types/api';

/** Buyer's own invoices with presigned PDF download. */
export default function BuyerInvoicesPage(): JSX.Element {
  const [pageIndex, setPageIndex] = useState(0);
  const query = useInvoices({ mode: 'buyer' });
  const download = useDownloadInvoice();

  const pages = useMemo(() => query.data?.pages ?? [], [query.data?.pages]);
  const invoices: InvoiceSummary[] = useMemo(() => pages[pageIndex]?.data ?? [], [pages, pageIndex]);

  const goNext = (): void => {
    if (pageIndex < pages.length - 1) setPageIndex((i) => i + 1);
    else if (query.hasNextPage) void query.fetchNextPage().then(() => setPageIndex((i) => i + 1));
  };

  const handleDownload = (invoice: InvoiceSummary): void => {
    download.mutate(invoice.id, {
      onError: (error) =>
        toast.error(error instanceof ApiClientError ? error.message : 'Download failed'),
    });
  };

  return (
    <>
      <PageHeader title="Your Invoices" description="Download invoice PDFs and track payment status." />
      <section className="panel">
        {query.isLoading ? (
          <LoadingSkeleton rows={8} columns={[2, 2, 1, 2, 1]} />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="hidden md:table-cell">Due Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">PDF</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-text-secondary">
                      You have no invoices yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  invoices.map((invoice) => {
                    const downloadingThis = download.isPending && download.variables === invoice.id;
                    return (
                      <TableRow key={invoice.id}>
                        <TableCell className="font-mono text-xs text-text-secondary">
                          <Link
                            href={`/portal/invoices/${invoice.id}`}
                            className="text-accent hover:underline"
                          >
                            {invoice.invoiceNumber}
                          </Link>
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatMoney(invoice.total)}
                        </TableCell>
                        <TableCell className="hidden text-text-secondary md:table-cell">
                          {formatDate(invoice.dueDate)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={invoice.status} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="default"
                            size="sm"
                            disabled={downloadingThis}
                            onClick={() => handleDownload(invoice)}
                          >
                            {downloadingThis ? (
                              <Spinner className="h-3.5 w-3.5" />
                            ) : (
                              <Download className="h-3.5 w-3.5" />
                            )}
                            <span className="hidden sm:inline">Download</span>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
            <CursorPagination
              hasPrevious={pageIndex > 0}
              hasNext={pageIndex < pages.length - 1 || query.hasNextPage}
              isLoading={query.isFetchingNextPage}
              onPrevious={() => setPageIndex((i) => Math.max(0, i - 1))}
              onNext={goNext}
            />
          </>
        )}
      </section>
    </>
  );
}
