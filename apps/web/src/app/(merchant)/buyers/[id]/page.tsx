'use client';

import { useEffect, useMemo } from 'react';
import Link from 'next/link';
import { notFound, useRouter } from 'next/navigation';
import { ArrowLeft, ShoppingCart } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { UpdateBuyerSchema, type UpdateBuyerInput } from '@b2b/shared/schemas';
import type { PaymentTerms } from '@b2b/shared/types';
import { PageContainer } from '@/components/merchant/PageLayout';
import {
  DataTable,
  DataTableHeader,
  DataTableHeaderCell,
  DataTableBody,
  DataTableRow,
  DataTableCell,
  DataTableEmpty,
} from '@/components/shared/DataTable';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton';
import { FadeIn } from '@/components/shared/FadeIn';
import { toast } from '@/components/shared/toasts';
import { useBuyerDetail, useUpdateBuyer } from '@/hooks/useBuyers';
import { usePricingTiers } from '@/hooks/usePricingTiers';
import { useOrders } from '@/hooks/useOrders';
import { ApiClientError } from '@/lib/api/error';
import { formatMoney, formatDate, formatRelative, formatPaymentTerms } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { BuyerDetail, OrderSummary } from '@/types/api';

const PAYMENT_TERMS: PaymentTerms[] = ['immediate', 'net15', 'net30', 'net60', 'net90'];
const PAYMENT_TERMS_LABELS: Record<PaymentTerms, string> = {
  immediate: 'Immediate',
  net15: 'Net 15',
  net30: 'Net 30',
  net60: 'Net 60',
  net90: 'Net 90',
};
const DEFAULT_TIER = '__default__';
const NOTES_MAX = 2000;

/**
 * Merchant buyer company-profile detail. The full-page counterpart to the
 * buyers-list slide-over: relationship KPIs + credit utilization, order history
 * (reusing the merchant orders list scoped by buyerId), and an inline edit form
 * for approved buyers (tier / terms / credit / notes) validated with the SAME
 * Zod schema the API enforces. The backend already exists — GET/PATCH /buyers/:id.
 */
export default function BuyerDetailPage({ params }: { params: { id: string } }): JSX.Element {
  const query = useBuyerDetail(params.id);

  // A true 404 (buyer not in this tenant) routes to the calm merchant not-found
  // page; transient/network failures fall through to the inline retry panel.
  if (query.error instanceof ApiClientError && query.error.statusCode === 404) {
    notFound();
  }

  if (query.isLoading) {
    return (
      <PageContainer>
        <BackLink />
        <div className="panel mt-4 p-6">
          <LoadingSkeleton rows={8} columns={[3, 2, 2, 2]} />
        </div>
      </PageContainer>
    );
  }

  if (query.isError || !query.data) {
    return (
      <PageContainer>
        <BackLink />
        <div className="panel mt-4 p-8 text-center">
          <p className="text-sm text-text-secondary">This buyer could not be loaded.</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <BuyerProfile buyer={query.data} />
    </PageContainer>
  );
}

function BackLink(): JSX.Element {
  return (
    <Link
      href="/buyers"
      className="inline-flex items-center gap-1.5 text-sm text-text-secondary transition-colors hover:text-text-primary"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to buyers
    </Link>
  );
}

function BuyerProfile({ buyer }: { buyer: BuyerDetail }): JSX.Element {
  const util = utilization(buyer);

  return (
    <FadeIn>
      <BackLink />

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight text-text-primary">{buyer.companyName}</h1>
            <StatusBadge status={buyer.approvalStatus} />
          </div>
          <p className="mt-1.5 text-base text-text-secondary">{buyer.email}</p>
        </div>
        <Button variant="secondary" asChild>
          <Link href={`/orders?buyerId=${buyer.buyerId}`}>View all orders</Link>
        </Button>
      </div>

      {/* KPI row */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Orders" value={String(buyer.orderCount)} />
        <StatCard label="Outstanding AR" value={formatMoney(buyer.outstandingInvoiceTotal)} money />
        <StatCard
          label="Credit Limit"
          value={buyer.creditLimit ? formatMoney(buyer.creditLimit) : 'No limit'}
          money={Boolean(buyer.creditLimit)}
        />
        <StatCard
          label="Credit Utilization"
          value={util ? `${util.pct}%` : '—'}
          footer={
            util ? (
              <span className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-neutral-bg">
                <span
                  className={cn(
                    'block h-full rounded-full',
                    util.pct >= 90 ? 'bg-danger' : util.pct >= 70 ? 'bg-warning' : 'bg-success',
                  )}
                  style={{ width: `${Math.min(util.pct, 100)}%` }}
                />
              </span>
            ) : (
              <span className="mt-2 block text-xs text-text-tertiary">Uncapped relationship</span>
            )
          }
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Order history */}
        <section className="lg:col-span-2">
          <h2 className="mb-3 text-label uppercase tracking-wider text-text-secondary">Order history</h2>
          <OrderHistory buyerId={buyer.buyerId} />
        </section>

        {/* Relationship + edit */}
        <section>
          <h2 className="mb-3 text-label uppercase tracking-wider text-text-secondary">Relationship</h2>
          <RelationshipCard buyer={buyer} />
        </section>
      </div>
    </FadeIn>
  );
}

/** AR consumed against the buyer's credit limit, or null when uncapped. */
function utilization(buyer: BuyerDetail): { pct: number } | null {
  const limit = buyer.creditLimit ? Number(buyer.creditLimit) : null;
  if (!limit || limit <= 0) return null;
  const used = Number(buyer.outstandingInvoiceTotal) || 0;
  return { pct: Math.round((used / limit) * 100) };
}

function StatCard({
  label,
  value,
  money = false,
  footer,
}: {
  label: string;
  value: string;
  money?: boolean;
  footer?: React.ReactNode;
}): JSX.Element {
  return (
    <div className="panel p-4">
      <p className="text-label uppercase tracking-wider text-text-secondary">{label}</p>
      <p
        className={cn('mt-1 text-2xl font-semibold text-text-primary', money && 'font-mono tabular-nums')}
        data-testid={money ? 'financial-cell' : undefined}
      >
        {value}
      </p>
      {footer}
    </div>
  );
}

function OrderHistory({ buyerId }: { buyerId: string }): JSX.Element {
  const router = useRouter();
  const query = useOrders({ mode: 'merchant', buyerId });
  const rows = useMemo<OrderSummary[]>(
    () => (query.data?.pages ?? []).flatMap((page) => page.data),
    [query.data],
  );

  if (query.isLoading) {
    return (
      <div className="panel p-4">
        <LoadingSkeleton rows={5} columns={[2, 1, 1, 2, 1]} />
      </div>
    );
  }

  return (
    <>
      <DataTable>
        <DataTableHeader>
          <tr>
            <DataTableHeaderCell>Order #</DataTableHeaderCell>
            <DataTableHeaderCell>Status</DataTableHeaderCell>
            <DataTableHeaderCell align="right">Total</DataTableHeaderCell>
            <DataTableHeaderCell>Placed</DataTableHeaderCell>
            <DataTableHeaderCell>Invoice</DataTableHeaderCell>
          </tr>
        </DataTableHeader>
        <DataTableBody>
          {rows.length === 0 ? (
            <DataTableEmpty
              colSpan={5}
              icon={<ShoppingCart className="h-6 w-6" />}
              title="No orders yet"
              message="This buyer hasn't placed any orders."
            />
          ) : (
            rows.map((order) => (
              <DataTableRow
                key={order.id}
                clickable
                onClick={() => router.push(`/orders/${order.id}`)}
              >
                <DataTableCell className="font-mono text-xs text-text-secondary">
                  {order.shopifyOrderNumber ?? '—'}
                </DataTableCell>
                <DataTableCell>
                  <StatusBadge status={order.status} />
                </DataTableCell>
                <DataTableCell align="right" className="font-mono" data-testid="financial-cell">
                  {formatMoney(order.total)}
                </DataTableCell>
                <DataTableCell className="text-text-secondary">{formatDate(order.createdAt)}</DataTableCell>
                <DataTableCell>
                  {order.invoiceStatus ? <StatusBadge status={order.invoiceStatus} /> : '—'}
                </DataTableCell>
              </DataTableRow>
            ))
          )}
        </DataTableBody>
      </DataTable>

      {query.hasNextPage ? (
        <div className="mt-4 flex justify-center">
          <Button
            variant="secondary"
            size="sm"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? <Spinner className="h-3.5 w-3.5" /> : null}
            Load more
          </Button>
        </div>
      ) : null}
    </>
  );
}

function RelationshipCard({ buyer }: { buyer: BuyerDetail }): JSX.Element {
  const { data: tiers } = usePricingTiers();
  const update = useUpdateBuyer();
  const isApproved = buyer.approvalStatus === 'approved';

  const form = useForm<UpdateBuyerInput>({
    resolver: zodResolver(UpdateBuyerSchema),
    defaultValues: {
      pricingTierId: buyer.pricingTierId,
      paymentTerms: buyer.paymentTerms,
      creditLimit: buyer.creditLimit,
      notes: buyer.notes ?? '',
    },
  });

  // Re-seed when the underlying record changes (post-save refetch / tenant swap).
  useEffect(() => {
    form.reset({
      pricingTierId: buyer.pricingTierId,
      paymentTerms: buyer.paymentTerms,
      creditLimit: buyer.creditLimit,
      notes: buyer.notes ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buyer.buyerId, buyer.pricingTierId, buyer.paymentTerms, buyer.creditLimit, buyer.notes]);

  const onSave = form.handleSubmit((values) => {
    update.mutate(
      { buyerId: buyer.buyerId, input: values },
      {
        onSuccess: () => toast.success('Buyer updated'),
        onError: (error) =>
          toast.error(error instanceof ApiClientError ? error.message : 'Update failed'),
      },
    );
  });

  const notes = form.watch('notes') ?? '';

  if (!isApproved) {
    return (
      <div className="panel p-5">
        <dl className="space-y-4">
          <Detail label="Pricing Tier" value={buyer.pricingTierName ?? 'Default'} />
          <Detail label="Payment Terms" value={formatPaymentTerms(buyer.paymentTerms)} />
          <Detail label="Business Type" value={buyer.businessType ?? '—'} />
          <Detail label="Member Since" value={formatDate(buyer.createdAt)} />
          <Detail label="Last Order" value={formatRelative(buyer.lastOrderAt)} />
        </dl>
        <p className="mt-4 border-t border-border pt-4 text-xs text-text-secondary">
          Relationship settings are editable only for approved buyers.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSave} className="panel space-y-4 p-5">
      <div className="grid grid-cols-2 gap-4">
        <Detail label="Member Since" value={formatDate(buyer.createdAt)} />
        <Detail label="Approved" value={buyer.approvedAt ? formatDate(buyer.approvedAt) : '—'} />
        <Detail label="Business Type" value={buyer.businessType ?? '—'} />
        <Detail label="Last Order" value={formatRelative(buyer.lastOrderAt)} />
      </div>

      <div className="space-y-1.5 border-t border-border pt-4">
        <Label htmlFor="editTier">Pricing Tier</Label>
        <Controller
          control={form.control}
          name="pricingTierId"
          render={({ field }) => (
            <Select
              value={field.value ?? DEFAULT_TIER}
              onValueChange={(v) => field.onChange(v === DEFAULT_TIER ? null : v)}
            >
              <SelectTrigger id="editTier">
                <SelectValue placeholder="Default tier" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_TIER}>Default tier</SelectItem>
                {(tiers ?? []).map((tier) => (
                  <SelectItem key={tier.id} value={tier.id}>
                    {tier.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="editTerms">Payment Terms</Label>
        <Controller
          control={form.control}
          name="paymentTerms"
          render={({ field }) => (
            <Select value={field.value ?? 'immediate'} onValueChange={field.onChange}>
              <SelectTrigger id="editTerms">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_TERMS.map((term) => (
                  <SelectItem key={term} value={term}>
                    {PAYMENT_TERMS_LABELS[term]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="editCredit">Credit Limit</Label>
        <Controller
          control={form.control}
          name="creditLimit"
          render={({ field }) => (
            <Input
              id="editCredit"
              inputMode="decimal"
              placeholder="No limit"
              value={field.value ?? ''}
              onChange={(e) => field.onChange(e.target.value === '' ? null : e.target.value)}
            />
          )}
        />
        {form.formState.errors.creditLimit ? (
          <p className="text-xs text-danger">{form.formState.errors.creditLimit.message}</p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="editNotes">Internal Notes</Label>
        <Textarea
          id="editNotes"
          rows={3}
          maxLength={NOTES_MAX}
          placeholder="Context for your team — never shown to the buyer."
          value={notes}
          onChange={(e) => form.setValue('notes', e.target.value, { shouldDirty: true })}
        />
        <div className="flex justify-end">
          <span className="text-xs text-text-tertiary tabular-nums">
            {notes.length}/{NOTES_MAX}
          </span>
        </div>
      </div>

      <Button
        type="submit"
        variant="primary"
        className="w-full"
        disabled={update.isPending || !form.formState.isDirty}
      >
        {update.isPending ? <Spinner /> : null}
        Save changes
      </Button>
    </form>
  );
}

function Detail({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-label uppercase tracking-wider text-text-secondary">{label}</span>
      <span className="break-words text-sm text-text-primary">{value}</span>
    </div>
  );
}
