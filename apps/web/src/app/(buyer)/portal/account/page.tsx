'use client';

import Link from 'next/link';
import { BellOff, BellRing, Plus } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { toast } from '@/components/shared/toasts';
import { useBuyerMe } from '@/hooks/useBuyerAccount';
import { useStandingOrders, useDeactivateStandingOrder, type StandingOrder } from '@/hooks/useStandingOrders';
import { ApiClientError } from '@/lib/api/error';
import { formatDate, formatMoney, formatPaymentTerms } from '@/lib/format';

/**
 * Buyer account page. Shows the buyer's own relationship snapshot (company, tier,
 * terms, credit) and the "Order Reminders" section — their active reorder
 * reminders, each with its next-reminder date and a turn-off control (deactivates,
 * never deletes). New reminders are created from the order history / detail.
 */
export default function BuyerAccountPage(): JSX.Element {
  const me = useBuyerMe();
  const reminders = useStandingOrders();
  const deactivate = useDeactivateStandingOrder();

  const turnOff = (reminder: StandingOrder): void => {
    deactivate.mutate(reminder.id, {
      onSuccess: () => toast.success('Reminder turned off'),
      onError: (error) =>
        toast.error(error instanceof ApiClientError ? error.message : 'Could not turn off reminder'),
    });
  };

  return (
    <>
      <PageHeader title="Your Account" description="Your wholesale relationship and reorder reminders." />

      {/* Account snapshot */}
      <section className="panel mb-6 p-5">
        <h2 className="mb-3 text-sm font-medium text-text-primary">Account</h2>
        {me.isLoading || !me.data ? (
          <LoadingSkeleton rows={3} columns={[2, 3]} />
        ) : (
          <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            <Detail label="Company" value={me.data.companyName} />
            <Detail label="Pricing tier" value={me.data.pricingTierName ?? 'Default'} />
            <Detail label="Payment terms" value={formatPaymentTerms(me.data.paymentTerms)} />
            <Detail
              label="Credit"
              value={
                me.data.creditLimit
                  ? `${formatMoney(me.data.creditUsed)} of ${formatMoney(me.data.creditLimit)} used`
                  : 'No limit'
              }
            />
            {me.data.memberSince ? <Detail label="Member since" value={formatDate(me.data.memberSince)} /> : null}
          </dl>
        )}
      </section>

      {/* Order reminders */}
      <section className="panel">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 text-sm font-medium text-text-primary">
            <BellRing className="h-4 w-4 text-text-secondary" /> Order Reminders
          </h2>
          <Button variant="secondary" size="sm" asChild>
            <Link href="/portal/orders">
              <Plus className="h-3.5 w-3.5" />
              Add reminder
            </Link>
          </Button>
        </div>

        {reminders.isLoading ? (
          <div className="p-4">
            <LoadingSkeleton rows={3} columns={[3, 2, 1]} />
          </div>
        ) : (reminders.data ?? []).length === 0 ? (
          <EmptyState
            compact
            icon={BellOff}
            title="No reminders yet"
            description="Set a reorder reminder from any of your past orders to never run low again."
            action={{ label: 'Go to your orders', href: '/portal/orders' }}
          />
        ) : (
          <ul className="divide-y divide-border">
            {(reminders.data ?? []).map((reminder) => (
              <li key={reminder.id} className="flex items-center justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text-primary">{reminder.name}</p>
                  <p className="text-xs text-text-secondary">
                    {reminder.frequencyLabel} · Next reminder: {formatDate(reminder.nextReminderAt)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={deactivate.isPending}
                  onClick={() => turnOff(reminder)}
                >
                  <BellOff className="h-3.5 w-3.5" />
                  Turn off
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-1.5 last:border-b-0 sm:border-b-0">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="text-right font-medium text-text-primary">{value}</dd>
    </div>
  );
}
