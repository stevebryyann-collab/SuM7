'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Check, X } from 'lucide-react';
import type { SubscriptionTier } from '@b2b/shared/types';
import { PageLayout } from '@/components/merchant/PageLayout';
import { SettingsTabs } from '@/components/merchant/SettingsTabs';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton';
import { useBillingPlan, useBillingUsage, useChangePlan, useCreatePortalSession } from '@/hooks/useBilling';
import { ApiClientError } from '@/lib/api/error';
import { formatMoney, formatDate } from '@/lib/format';
import { cn } from '@/lib/cn';

interface PlanSpec {
  tier: SubscriptionTier;
  name: string;
  price: string;
  freeTier: string;
  rate: string;
  bnpl: boolean;
  advancedAnalytics: boolean;
  prioritySupport: boolean;
}

const PLANS: PlanSpec[] = [
  { tier: 'starter', name: 'Starter', price: '$29', freeTier: '$20K', rate: '0.5%', bnpl: false, advancedAnalytics: false, prioritySupport: false },
  { tier: 'growth', name: 'Growth', price: '$79', freeTier: '$50K', rate: '0.4%', bnpl: true, advancedAnalytics: false, prioritySupport: false },
  { tier: 'pro', name: 'Pro', price: '$199', freeTier: '$150K', rate: '0.3%', bnpl: true, advancedAnalytics: true, prioritySupport: true },
];

const TIER_RATE_LABEL: Record<string, string> = { starter: '0.5%', growth: '0.4%', pro: '0.3%' };

export default function BillingSettingsPage(): JSX.Element {
  const { data: plan, isLoading: planLoading } = useBillingPlan();
  const { data: usage, isLoading: usageLoading } = useBillingUsage();
  const portal = useCreatePortalSession();
  const changePlan = useChangePlan();

  const [modalOpen, setModalOpen] = useState(false);
  const [pendingTier, setPendingTier] = useState<SubscriptionTier | null>(null);

  const isTrial = plan?.isTrial ?? false;

  const confirmChange = (): void => {
    if (!pendingTier) return;
    const tier = pendingTier;
    changePlan.mutate(tier, {
      onSuccess: () => {
        toast.success('Plan updated');
        setPendingTier(null);
        setModalOpen(false);
      },
      onError: (error) => {
        setPendingTier(null);
        toast.error(error instanceof ApiClientError ? error.message : 'Could not update plan');
      },
    });
  };

  return (
    <PageLayout title="Billing" subtitle="Your plan, GMV usage, and payment method.">
      <SettingsTabs />

      <div className="space-y-6">
        {/* Current plan */}
        <section className="panel p-5">
          {planLoading || !plan ? (
            <LoadingSkeleton rows={3} columns={[2, 3]} />
          ) : (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold capitalize text-text-primary">{plan.tier} plan</h2>
                  <PlanStatusBadge status={String(plan.status)} />
                </div>
                <p className="mt-1 text-sm text-text-secondary">
                  {plan.priceLabel}
                  {plan.nextBillingDate ? (
                    <>
                      {' · '}
                      {isTrial ? 'Trial ends' : 'Next billing'} {formatDate(plan.nextBillingDate)}
                    </>
                  ) : null}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="default" size="sm" disabled={portal.isPending} onClick={() => portal.mutate()}>
                  {portal.isPending ? <Spinner /> : null}
                  Manage billing
                </Button>
                <Button variant="primary" size="sm" onClick={() => setModalOpen(true)}>
                  {isTrial ? 'Choose a plan' : 'Change plan'}
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* GMV usage */}
        <section className="panel p-5">
          <h2 className="text-base font-semibold text-text-primary">GMV usage this month</h2>
          {usageLoading || !usage ? (
            <div className="mt-4">
              <LoadingSkeleton rows={2} columns={[4]} />
            </div>
          ) : (
            <UsageMeter
              gmv={Number(usage.gmvCurrentMonth)}
              freeThreshold={Number(usage.freeThreshold)}
              billable={Number(usage.billableGmv)}
              estimatedFee={usage.estimatedFee}
              rateLabel={TIER_RATE_LABEL[String(usage.tier)] ?? '0.5%'}
            />
          )}
        </section>

        {/* Plan comparison */}
        <section className="panel overflow-hidden">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-label uppercase tracking-wider text-text-secondary">Plan comparison</h2>
          </div>
          <PlanComparison currentTier={plan ? (plan.tier as SubscriptionTier) : null} />
        </section>
      </div>

      <ChangePlanModal
        open={modalOpen}
        onOpenChange={(open) => !changePlan.isPending && setModalOpen(open)}
        currentTier={plan ? (plan.tier as SubscriptionTier) : null}
        onSelect={(tier) => setPendingTier(tier)}
      />

      <ConfirmDialog
        open={pendingTier !== null}
        onOpenChange={(open) => !open && setPendingTier(null)}
        title="Change plan?"
        description="You'll be charged the prorated difference immediately."
        confirmLabel="Confirm change"
        isLoading={changePlan.isPending}
        onConfirm={confirmChange}
      />
    </PageLayout>
  );
}

function PlanStatusBadge({ status }: { status: string }): JSX.Element {
  const tone: Record<string, string> = {
    active: 'bg-green-100 text-green-800',
    trial: 'bg-ocean-soft text-ocean-deep',
    inactive: 'bg-red-100 text-red-800',
  };
  const label = status.length > 0 ? status[0]!.toUpperCase() + status.slice(1) : status;
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', tone[status] ?? 'bg-fog-soft text-text-primary')}>
      {label}
    </span>
  );
}

function UsageMeter({
  gmv,
  freeThreshold,
  billable,
  estimatedFee,
  rateLabel,
}: {
  gmv: number;
  freeThreshold: number;
  billable: number;
  estimatedFee: string;
  rateLabel: string;
}): JSX.Element {
  const pct = freeThreshold > 0 ? Math.min(100, Math.round((gmv / freeThreshold) * 100)) : 0;
  const overFreeTier = billable > 0;
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between text-sm">
        <span className="text-text-secondary">
          {formatMoney(gmv)} of {formatMoney(freeThreshold)} free tier used
        </span>
        <span className="tabular-nums text-text-secondary">{pct}%</span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-fog-soft">
        <div
          className={cn('h-full rounded-full', overFreeTier ? 'bg-red-500' : 'bg-accent')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-sm text-text-secondary">
        {overFreeTier ? (
          <>
            You have used {formatMoney(gmv)} of GMV. {formatMoney(billable)} is billable at {rateLabel} ={' '}
            <span className="font-medium text-text-primary">{formatMoney(estimatedFee)}</span> in usage fees.
          </>
        ) : (
          'No usage fees this month.'
        )}
      </p>
    </div>
  );
}

function PlanComparison({ currentTier }: { currentTier: SubscriptionTier | null }): JSX.Element {
  const rows: { label: string; render: (plan: PlanSpec) => JSX.Element | string }[] = [
    { label: 'Monthly price', render: (p) => `${p.price}/mo` },
    { label: 'GMV free tier', render: (p) => p.freeTier },
    { label: 'GMV rate above', render: (p) => p.rate },
    { label: 'BNPL', render: (p) => <BoolMark on={p.bnpl} /> },
    { label: 'Advanced analytics', render: (p) => <BoolMark on={p.advancedAnalytics} /> },
    { label: 'Priority support', render: (p) => <BoolMark on={p.prioritySupport} /> },
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="px-4 py-2 text-left font-medium text-text-secondary">Feature</th>
            {PLANS.map((plan) => (
              <th key={plan.tier} className="px-4 py-2 text-center font-semibold text-text-primary">
                {plan.name}
                {currentTier === plan.tier ? (
                  <span className="ml-1.5 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-accent-fg">
                    Current
                  </span>
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-border last:border-0">
              <td className="px-4 py-2 text-text-secondary">{row.label}</td>
              {PLANS.map((plan) => (
                <td key={plan.tier} className="px-4 py-2 text-center tabular-nums text-text-primary">
                  {row.render(plan)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BoolMark({ on }: { on: boolean }): JSX.Element {
  return on ? (
    <Check className="mx-auto h-4 w-4 text-green-600" />
  ) : (
    <X className="mx-auto h-4 w-4 text-text-tertiary" />
  );
}

function ChangePlanModal({
  open,
  onOpenChange,
  currentTier,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentTier: SubscriptionTier | null;
  onSelect: (tier: SubscriptionTier) => void;
}): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Change plan</DialogTitle>
          <DialogDescription>Pick a plan. You&apos;ll be charged the prorated difference immediately.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {PLANS.map((plan) => {
              const isCurrent = currentTier === plan.tier;
              return (
                <div
                  key={plan.tier}
                  className={cn(
                    'flex flex-col rounded-lg border p-4',
                    isCurrent ? 'border-accent bg-accent/5' : 'border-glass-border',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-text-primary">{plan.name}</h3>
                    {isCurrent ? (
                      <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-accent-fg">
                        Current plan
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-2xl font-semibold tracking-tight text-text-primary">{plan.price}</p>
                  <p className="text-xs text-text-secondary">per month</p>
                  <ul className="mt-3 flex-1 space-y-1 text-xs text-text-secondary">
                    <li>{plan.freeTier} GMV free tier</li>
                    <li>{plan.rate} on GMV above</li>
                    {plan.bnpl ? <li>BNPL enabled</li> : null}
                    {plan.advancedAnalytics ? <li>Advanced analytics</li> : null}
                    {plan.prioritySupport ? <li>Priority support</li> : null}
                  </ul>
                  <Button
                    variant={isCurrent ? 'default' : 'primary'}
                    size="sm"
                    className="mt-4"
                    disabled={isCurrent}
                    onClick={() => onSelect(plan.tier)}
                  >
                    {isCurrent ? 'Current plan' : `Select ${plan.name}`}
                  </Button>
                </div>
              );
            })}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
