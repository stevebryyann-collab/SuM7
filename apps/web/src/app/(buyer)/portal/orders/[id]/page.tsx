'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Check, Copy, ExternalLink, PackageCheck, ShoppingCart, Truck } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import {
  DataTable,
  DataTableHeader,
  DataTableHeaderCell,
  DataTableBody,
  DataTableRow,
  DataTableCell,
} from '@/components/shared/DataTable';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton';
import { toast } from '@/components/shared/toasts';
import { useOrder } from '@/hooks/useOrders';
import { useCreateStandingOrder } from '@/hooks/useStandingOrders';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { ApiClientError } from '@/lib/api/error';
import { stageCartSeed } from '@/lib/cart-seed';
import { formatDate, formatMoney, formatPaymentTerms } from '@/lib/format';
import type { OrderDetail } from '@/types/api';

const FREQUENCIES = [
  { days: 7, label: 'Every week' },
  { days: 14, label: 'Every 2 weeks' },
  { days: 30, label: 'Monthly' },
] as const;

/** Buyer's own order detail — line items, totals, fulfillment tracking, and a reorder prompt. */
export default function BuyerOrderDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const router = useRouter();
  const { data: order, isLoading, isError } = useOrder('buyer', id);

  // "Reorder" — seed the catalog cart from this order's lines and jump there.
  const reorder = (): void => {
    if (!order) return;
    const seed: Record<string, number> = {};
    for (const line of order.lineItems) {
      if (line.shopifyVariantId && line.quantity > 0) {
        seed[line.shopifyVariantId] = (seed[line.shopifyVariantId] ?? 0) + line.quantity;
      }
    }
    if (!stageCartSeed(seed)) {
      toast.error('These items can’t be reordered from the catalog.');
      return;
    }
    toast.success('Loading these items into your cart…');
    router.push('/portal/catalog');
  };

  if (isLoading) {
    return (
      <>
        <PageHeader title="Order" description="Loading…" />
        <section className="panel p-4">
          <LoadingSkeleton rows={6} columns={[3, 1, 1, 1]} />
        </section>
      </>
    );
  }

  if (isError || !order) {
    return (
      <>
        <Link href="/portal/orders" className="mb-4 inline-flex items-center gap-1 text-sm text-accent hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back to orders
        </Link>
        <div className="panel p-8 text-center text-sm text-danger">
          We couldn&apos;t load this order. Please refresh or go back to your order history.
        </div>
      </>
    );
  }

  return (
    <>
      <Link href="/portal/orders" className="mb-4 inline-flex items-center gap-1 text-sm text-accent hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to orders
      </Link>

      <PageHeader
        title={`Order ${order.shopifyOrderNumber ?? ''}`.trim()}
        description={`Placed ${formatDate(order.createdAt)}`}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={reorder} disabled={order.lineItems.length === 0}>
              <ShoppingCart className="h-4 w-4" /> Reorder
            </Button>
            <StatusBadge status={order.status} />
          </>
        }
      />

      {/* Back-order notice */}
      {order.containsBackOrder && order.status !== 'fulfilled' ? (
        <div className="mb-4 rounded-lg border border-warning-border bg-warning-bg px-4 py-3 text-sm text-warning">
          This order contains back-ordered items. We&apos;ll notify you when it ships.
        </div>
      ) : null}

      {/* Line items */}
      <section className="mb-4">
        <DataTable>
          <DataTableHeader>
            <tr>
              <DataTableHeaderCell>Product</DataTableHeaderCell>
              <DataTableHeaderCell align="right">Qty</DataTableHeaderCell>
              <DataTableHeaderCell align="right">Unit</DataTableHeaderCell>
              <DataTableHeaderCell align="right">Line total</DataTableHeaderCell>
            </tr>
          </DataTableHeader>
          <DataTableBody>
            {order.lineItems.map((line, i) => (
              <DataTableRow key={`${line.shopifyVariantId ?? line.productTitle}-${i}`}>
                <DataTableCell>
                  <span className="text-text-primary">{line.productTitle}</span>
                  {line.variantTitle ? <span className="text-text-tertiary"> · {line.variantTitle}</span> : null}
                  {line.sku ? <div className="text-2xs text-text-tertiary">SKU {line.sku}</div> : null}
                </DataTableCell>
                <DataTableCell align="right">{line.quantity}</DataTableCell>
                <DataTableCell align="right" className="font-mono">{formatMoney(line.unitPrice)}</DataTableCell>
                <DataTableCell align="right" className="font-mono">{formatMoney(line.lineTotal)}</DataTableCell>
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>
      </section>

      {/* Totals + invoice */}
      <section className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="panel p-5">
          <h2 className="mb-3 text-sm font-medium text-text-primary">Summary</h2>
          <dl className="space-y-1.5 text-sm">
            <SummaryRow label="Subtotal" value={formatMoney(order.subtotal)} />
            <SummaryRow label="Tax" value={formatMoney(order.taxAmount)} />
            <SummaryRow label="Shipping" value={formatMoney(order.shippingAmount)} />
            <div className="border-t border-border pt-1.5">
              <SummaryRow label="Total" value={formatMoney(order.total)} strong />
            </div>
            <SummaryRow label="Payment terms" value={formatPaymentTerms(order.paymentTerms)} />
            {order.dueDate ? <SummaryRow label="Due date" value={formatDate(order.dueDate)} /> : null}
          </dl>
          {order.invoice ? (
            <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-sm">
              <span className="text-text-secondary">
                Invoice <span className="font-mono text-text-primary">{order.invoice.invoiceNumber}</span>
              </span>
              <div className="flex items-center gap-2">
                <StatusBadge status={order.invoice.status} />
                <Button variant="secondary" size="sm" asChild>
                  <Link href="/portal/invoices">View invoice</Link>
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        <ShipmentCard order={order} />
      </section>

      <ReorderPrompt orderId={order.id} />
    </>
  );
}

/** Fulfillment / tracking card — shown when the order has shipped or is fulfilled. */
function ShipmentCard({ order }: { order: OrderDetail }): JSX.Element | null {
  const { copy, copied } = useCopyToClipboard();

  if (order.trackingNumber) {
    return (
      <div className="panel p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-text-primary">
          <Truck className="h-4 w-4 text-text-secondary" /> Shipment Status
        </h2>
        <dl className="space-y-1.5 text-sm">
          {order.fulfillmentService ? <SummaryRow label="Carrier" value={order.fulfillmentService} /> : null}
          <div className="flex items-center justify-between">
            <dt className="text-text-secondary">Tracking number</dt>
            <dd className="flex items-center gap-1.5">
              <span className="font-mono text-text-primary">{order.trackingNumber}</span>
              <button
                type="button"
                onClick={() => order.trackingNumber && void copy(order.trackingNumber)}
                aria-label="Copy tracking number"
                className="text-text-tertiary transition-colors duration-fast hover:text-text-primary"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </dd>
          </div>
          {order.shippedAt ? <SummaryRow label="Shipped" value={formatDate(order.shippedAt)} /> : null}
          {order.estimatedDeliveryAt ? (
            <SummaryRow label="Estimated delivery" value={formatDate(order.estimatedDeliveryAt)} />
          ) : null}
        </dl>
        {order.trackingUrl ? (
          <Button variant="primary" size="sm" className="mt-4" asChild>
            <a href={order.trackingUrl} target="_blank" rel="noopener noreferrer">
              Track Package
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        ) : null}
      </div>
    );
  }

  if (order.status === 'fulfilled') {
    return (
      <div className="panel flex flex-col items-start gap-2 p-5">
        <h2 className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <PackageCheck className="h-4 w-4 text-success" /> Fulfilled
        </h2>
        <p className="text-sm text-text-secondary">
          Your order has been fulfilled. Contact the merchant for tracking details.
        </p>
      </div>
    );
  }

  return (
    <div className="panel flex flex-col items-start gap-2 p-5">
      <h2 className="flex items-center gap-2 text-sm font-medium text-text-primary">
        <Truck className="h-4 w-4 text-text-tertiary" /> Shipment Status
      </h2>
      <p className="text-sm text-text-secondary">
        We&apos;ll show carrier and tracking details here as soon as your order ships.
      </p>
    </div>
  );
}

/** "Set a reminder to reorder?" prompt — creates a standing order from this order. */
function ReorderPrompt({ orderId }: { orderId: string }): JSX.Element {
  const create = useCreateStandingOrder();
  const [done, setDone] = useState<string | null>(null);

  const setReminder = (days: 7 | 14 | 30, label: string): void => {
    create.mutate(
      { sourceOrderId: orderId, frequencyDays: days },
      {
        onSuccess: () => {
          setDone(label);
          toast.success(`We'll remind you to reorder ${label.toLowerCase()}.`);
        },
        onError: (error) =>
          toast.error(error instanceof ApiClientError ? error.message : 'Could not set reminder'),
      },
    );
  };

  if (done) {
    return (
      <div className="panel flex items-center gap-2 p-4 text-sm text-text-secondary">
        <Check className="h-4 w-4 text-success" />
        We&apos;ll remind you to reorder {done.toLowerCase()}.{' '}
        <Link href="/portal/account" className="text-accent hover:underline">
          Manage reminders
        </Link>
      </div>
    );
  }

  return (
    <div className="panel flex flex-wrap items-center gap-3 p-4">
      <span className="text-sm font-medium text-text-primary">Set a reminder to reorder?</span>
      <div className="flex flex-wrap gap-2">
        {FREQUENCIES.map((freq) => (
          <Button
            key={freq.days}
            variant="secondary"
            size="sm"
            disabled={create.isPending}
            onClick={() => setReminder(freq.days, freq.label)}
          >
            {freq.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function SummaryRow({ label, value, strong }: { label: string; value: string; strong?: boolean }): JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-text-secondary">{label}</dt>
      <dd className={strong ? 'font-semibold tabular-nums text-text-primary' : 'tabular-nums text-text-primary'}>
        {value}
      </dd>
    </div>
  );
}
