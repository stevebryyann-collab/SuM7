'use client';

import Link from 'next/link';
import { ExternalLink, FileText } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { SyncStatusBadge } from '@/components/merchant/SyncStatusBadge';
import { formatDate, formatMoney } from '@/lib/format';
import type { OrderDetail as OrderDetailType } from '@/types/api';

/** A tiny neutral product thumbnail — order lines carry no image, so we render a
 * 32px monogram placeholder rather than a broken image. */
function Thumb({ title }: { title: string }): JSX.Element {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-gray-200 bg-gray-50 text-xs font-medium text-gray-500">
      {title.slice(0, 1).toUpperCase()}
    </span>
  );
}

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="text-right font-medium text-gray-900">{children}</span>
    </div>
  );
}

export interface OrderDetailProps {
  order: OrderDetailType;
  shopifyDomain: string | null;
}

export function OrderDetail({ order, shopifyDomain }: OrderDetailProps): JSX.Element {
  const shopifyUrl =
    shopifyDomain && order.shopifyOrderId
      ? `https://${shopifyDomain}/admin/orders/${order.shopifyOrderId}`
      : null;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <nav className="mb-1 text-xs text-gray-500">
            <Link href="/orders" className="hover:text-gray-700">
              Orders
            </Link>
            <span className="px-1.5">/</span>
            <span className="font-mono text-gray-700">{order.shopifyOrderNumber ?? order.id}</span>
          </nav>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-gray-900">
              Order {order.shopifyOrderNumber ?? ''}
            </h1>
            <StatusBadge status={order.status} />
            {order.invoice ? <StatusBadge status={order.invoice.status} /> : null}
            <SyncStatusBadge status={order.syncStatus} />
          </div>
          <p className="mt-1 text-sm text-gray-500">Placed {formatDate(order.createdAt)}</p>
        </div>
        <div className="flex items-center gap-2">
          {order.invoice ? (
            <Link href={`/invoices/${order.invoice.id}`}>
              <Button variant="default" size="sm">
                <FileText className="h-3.5 w-3.5" />
                View Invoice
              </Button>
            </Link>
          ) : null}
          {shopifyUrl ? (
            <a href={shopifyUrl} target="_blank" rel="noopener noreferrer">
              <Button variant="default" size="sm">
                <ExternalLink className="h-3.5 w-3.5" />
                Open in Shopify
              </Button>
            </a>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Line items */}
        <section className="panel lg:col-span-2">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit Price</TableHead>
                  <TableHead className="text-right">Discount</TableHead>
                  <TableHead className="text-right">Line Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.lineItems.map((line, i) => (
                  <TableRow key={`${line.sku ?? line.productTitle}-${i}`}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Thumb title={line.productTitle} />
                        <div className="min-w-0">
                          <div className="truncate font-medium text-gray-900">{line.productTitle}</div>
                          {line.variantTitle ? (
                            <div className="truncate text-xs text-gray-500">{line.variantTitle}</div>
                          ) : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-gray-600">{line.sku ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{line.quantity}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatMoney(line.unitPrice)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-gray-600">
                      {line.discountPct ? `${Number(line.discountPct).toFixed(0)}%` : '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatMoney(line.lineTotal)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="ml-auto w-full max-w-xs space-y-1 border-t border-gray-200 px-4 py-3">
            <SummaryRow label="Subtotal">{formatMoney(order.subtotal)}</SummaryRow>
            <SummaryRow label="Tax">{formatMoney(order.taxAmount)}</SummaryRow>
            <SummaryRow label="Shipping">{formatMoney(order.shippingAmount)}</SummaryRow>
            <div className="flex items-center justify-between border-t border-gray-200 pt-2 text-sm font-semibold text-gray-900">
              <span>Total</span>
              <span className="font-mono tabular-nums">{formatMoney(order.total)}</span>
            </div>
          </div>
        </section>

        {/* Order summary */}
        <section className="panel h-fit p-4">
          <h2 className="mb-2 text-label font-medium uppercase tracking-wider text-gray-500">
            Order Summary
          </h2>
          <SummaryRow label="Buyer">
            <Link href={`/buyers/${order.buyerId}`} className="text-accent hover:underline">
              {order.buyerCompanyName ?? '—'}
            </Link>
          </SummaryRow>
          <SummaryRow label="Payment Terms">
            <span className="uppercase">{order.paymentTerms ?? '—'}</span>
          </SummaryRow>
          <SummaryRow label="Invoice Due">
            {order.dueDate ? formatDate(order.dueDate) : '—'}
          </SummaryRow>
          <SummaryRow label="Invoice">
            {order.invoice ? (
              <Link href={`/invoices/${order.invoice.id}`} className="font-mono text-accent hover:underline">
                {order.invoice.invoiceNumber}
              </Link>
            ) : (
              <span className="text-gray-400">Not yet generated</span>
            )}
          </SummaryRow>
          <SummaryRow label="Shopify Order">
            {shopifyUrl ? (
              <a href={shopifyUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                {order.shopifyOrderNumber ?? 'View'}
              </a>
            ) : (
              <span className="text-gray-400">—</span>
            )}
          </SummaryRow>
          {order.notes ? (
            <div className="mt-3 border-t border-gray-200 pt-3 text-sm">
              <div className="mb-1 text-gray-500">Notes</div>
              <p className="whitespace-pre-wrap text-gray-700">{order.notes}</p>
            </div>
          ) : null}
        </section>
      </div>
    </>
  );
}
