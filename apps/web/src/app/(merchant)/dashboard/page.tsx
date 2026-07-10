'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, BookCheck, Check, CircleDashed } from 'lucide-react';
import { PageLayout } from '@/components/merchant/PageLayout';
import { DashboardKpiCard } from '@/components/merchant/DashboardKpiCard';
import { GmvMilestoneToast } from '@/components/merchant/GmvMilestoneToast';
import { ArAgingChart } from '@/components/merchant/ArAgingChart';
import { GmvTrendChart } from '@/components/merchant/GmvTrendChart';
import { InvoiceTable } from '@/components/merchant/InvoiceTable';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/EmptyState';
import { FadeIn } from '@/components/shared/FadeIn';
import {
  KpiCardSkeleton,
  ChartSkeleton,
  InvoiceTableSkeleton,
} from '@/components/shared/LoadingSkeleton';
import { useDashboard } from '@/hooks/useDashboard';
import { formatMoney, formatRelative } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { InvoiceSummary } from '@/types/api';

/**
 * Merchant dashboard. A single aggregator request (`GET /api/v1/dashboard`)
 * answers one question on sight — "is my wholesale business healthy right now?" —
 * across three rows: KPI cards (GMV, AR, overdue, applications), the AR-aging +
 * GMV-trend charts, and an action list (invoices needing attention + pending
 * applications). A freshly-installed store also gets the trial banner + Get
 * Started checklist; both retire once the store is set up and subscribed.
 */

/** Attention ordering for the "Needs Attention" panel: overdue → sent → viewed. */
const ATTENTION_PRIORITY: Record<string, number> = {
  overdue: 0,
  partially_paid: 1,
  sent: 2,
  viewed: 3,
};

function needsAttention(invoices: InvoiceSummary[]): InvoiceSummary[] {
  return invoices
    .filter((inv) => inv.status in ATTENTION_PRIORITY)
    .sort((a, b) => (ATTENTION_PRIORITY[a.status] ?? 9) - (ATTENTION_PRIORITY[b.status] ?? 9))
    .slice(0, 8);
}

export default function DashboardPage(): JSX.Element {
  const { data, isLoading, isError } = useDashboard();

  const kpis = data?.kpis;

  // First-buyer-approval celebration: briefly flash the Pending Applications
  // KPI card's border when newBuyersThisMonth crosses 0 → positive — the same
  // "compare previous to current" approach the Sidebar uses for its pending-
  // buyers pulse. Ref (not state) for the previous value so the comparison
  // doesn't itself trigger a re-render.
  const [pulseNewBuyers, setPulseNewBuyers] = useState(false);
  const prevNewBuyers = useRef<number | null>(null);
  useEffect(() => {
    const current = kpis?.newBuyersThisMonth;
    if (current === undefined) return;
    const previous = prevNewBuyers.current;
    prevNewBuyers.current = current;
    if (previous === 0 && current > 0) {
      setPulseNewBuyers(true);
      const timer = window.setTimeout(() => setPulseNewBuyers(false), 3000);
      return () => window.clearTimeout(timer);
    }
  }, [kpis?.newBuyersThisMonth]);
  const setup = data?.setup;
  const hasTier = setup?.hasTier ?? false;
  const hasApprovedBuyer = setup?.hasApprovedBuyer ?? false;
  const hasSubscription = setup?.hasSubscription ?? false;
  const setupComplete = hasTier && hasApprovedBuyer && hasSubscription;

  const attention = needsAttention(data?.recentInvoices ?? []);
  const pending = data?.pendingApplications ?? [];
  const trend = data?.gmvTrend ?? [];
  const aging = data?.aging;
  const overdueCount = kpis?.overdueInvoiceCount ?? 0;

  if (isError) {
    return (
      <PageLayout title="Dashboard" subtitle="Receivables and order activity at a glance.">
        <div className="rounded-lg border border-border bg-surface p-8 text-center text-sm text-danger shadow-sm">
          Dashboard failed to load. Refresh to try again.
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout title="Dashboard" subtitle="Receivables and order activity at a glance.">
      {/* Fires strategic GMV milestone toasts (once per milestone). Renders nothing. */}
      <GmvMilestoneToast />

      {/* Trial banner — until the merchant subscribes. */}
      {!isLoading && !hasSubscription ? (
        <div className="mb-6 flex flex-col gap-3 rounded-lg border border-accent-border bg-accent-subtle p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-text-primary">You&apos;re on the 14-day free trial.</p>
            <p className="text-sm text-text-secondary">
              Choose a plan to keep your portal active after the trial ends.
            </p>
          </div>
          <Button variant="primary" size="sm" asChild>
            <Link href="/settings/billing">
              Choose a plan
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      ) : null}

      {/* Get Started checklist (until setup is complete). */}
      {!isLoading && !setupComplete ? (
        <section className="mb-6 rounded-lg border border-border bg-surface p-5 shadow-sm">
          <h2 className="text-base font-semibold text-text-primary">Get started</h2>
          <p className="mt-0.5 text-sm text-text-secondary">A few steps to start taking wholesale orders.</p>
          <ol className="mt-4 space-y-2">
            <ChecklistItem done={hasTier} label="Create your first pricing tier" href="/pricing" cta="Set up pricing" />
            <ChecklistItem done={hasApprovedBuyer} label="Approve your first buyer" href="/buyers" cta="Review applications" />
            <ChecklistItem done={hasSubscription} label="Choose a subscription plan" href="/settings/billing" cta="Choose a plan" />
          </ol>
        </section>
      ) : null}

      {/* ROW 1 — KPI cards */}
      {isLoading || !kpis ? (
        <KpiCardSkeleton />
      ) : (
        <FadeIn delay={0}>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <DashboardKpiCard
              title="GMV This Month"
              value={formatMoney(kpis.gmvCurrentMonth)}
              changePercent={kpis.gmvChangePercent}
              changePeriod="vs last month"
              link="/analytics"
            />
            <DashboardKpiCard
              title="Outstanding AR"
              value={formatMoney(kpis.outstandingArBalance)}
              subLabel={`${overdueCount} invoice${overdueCount === 1 ? '' : 's'} overdue`}
              danger={overdueCount > 0}
              link="/invoices"
            />
            <DashboardKpiCard
              title="Overdue Invoices"
              value={String(overdueCount)}
              subLabel={`${formatMoney(kpis.overdueInvoiceAmount)} overdue`}
              danger={overdueCount > 0}
              badgeCount={overdueCount}
              badgePulse={overdueCount > 0}
              link="/invoices?status=overdue"
            />
            <DashboardKpiCard
              title="Pending Applications"
              value={String(kpis.pendingApplicationCount)}
              subLabel={`${kpis.newBuyersThisMonth} approved this month`}
              badgeCount={kpis.pendingApplicationCount}
              link="/buyers?status=pending"
              flashSuccess={pulseNewBuyers}
            />
          </div>
        </FadeIn>
      )}

      {/* ROW 2 — charts */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-5">
        <ChartCard title="GMV Trend" period="Last 30 days" className="lg:col-span-3">
          {isLoading ? (
            <ChartSkeleton height={220} />
          ) : (
            <FadeIn delay={50}>
              <GmvTrendChart data={trend} />
            </FadeIn>
          )}
        </ChartCard>
        <ChartCard title="AR Aging" period="Current AR" className="lg:col-span-2">
          {isLoading || !aging ? (
            <ChartSkeleton height={220} />
          ) : (
            <FadeIn delay={50}>
              <ArAgingChart data={aging} />
            </FadeIn>
          )}
        </ChartCard>
      </div>

      {/* ROW 3 — action items */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-5">
        <section className="lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-text-primary">Needs Attention</h2>
            <Link href="/invoices" className="text-xs text-accent hover:underline">
              View all invoices →
            </Link>
          </div>
          {isLoading ? (
            <InvoiceTableSkeleton rows={6} />
          ) : attention.length === 0 ? (
            <FadeIn delay={100}>
              <div className="rounded-lg border border-border bg-surface shadow-sm">
                <EmptyState
                  compact
                  icon={Check}
                  iconClassName="text-success"
                  title="Nothing needs attention"
                  description="No overdue or unpaid invoices right now."
                />
              </div>
            </FadeIn>
          ) : (
            <FadeIn delay={100}>
              <InvoiceTable invoices={attention} />
            </FadeIn>
          )}
        </section>

        <section className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-text-primary">Pending Applications</h2>
            {pending.length > 0 ? (
              <Link href="/buyers?status=pending" className="text-xs text-accent hover:underline">
                View all ({kpis?.pendingApplicationCount ?? pending.length}) →
              </Link>
            ) : null}
          </div>
          <div className="rounded-lg border border-border bg-surface shadow-sm">
            {isLoading ? (
              <div className="divide-y divide-border">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="px-4 py-3">
                    <div className="h-3.5 w-32 animate-pulse rounded bg-neutral-bg" />
                    <div className="mt-2 h-3 w-24 animate-pulse rounded bg-neutral-bg" />
                  </div>
                ))}
              </div>
            ) : pending.length === 0 ? (
              <FadeIn delay={100}>
                <EmptyState
                  compact
                  icon={BookCheck}
                  iconClassName="text-success"
                  title="No pending applications"
                  description="All caught up!"
                />
              </FadeIn>
            ) : (
              <FadeIn delay={100}>
                <ul className="divide-y divide-border">
                  {pending.slice(0, 5).map((app) => (
                    <li key={app.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-text-primary">{app.companyName}</p>
                        <p className="truncate text-xs text-text-secondary">{app.businessType ?? 'Business'}</p>
                        <p className="truncate text-2xs text-text-tertiary">Applied {formatRelative(app.createdAt)}</p>
                      </div>
                      <Button variant="ghost" size="sm" asChild>
                        <Link href="/buyers?status=pending">Review</Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              </FadeIn>
            )}
          </div>
        </section>
      </div>
    </PageLayout>
  );
}

function ChartCard({
  title,
  period,
  className,
  children,
}: {
  title: string;
  period: string;
  className?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className={cn('rounded-lg border border-border bg-surface p-5 shadow-sm', className)}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium text-text-primary">{title}</h2>
        <span className="text-xs text-text-secondary">{period}</span>
      </div>
      {children}
    </section>
  );
}

function ChecklistItem({
  done,
  label,
  href,
  cta,
}: {
  done: boolean;
  label: string;
  href: string;
  cta: string;
}): JSX.Element {
  return (
    <li className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2.5">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
            done ? 'bg-success-bg text-success' : 'bg-neutral-bg text-text-tertiary',
          )}
        >
          {done ? <Check className="h-3.5 w-3.5" /> : <CircleDashed className="h-3.5 w-3.5" />}
        </span>
        <span className={cn('text-sm', done ? 'text-text-tertiary line-through' : 'text-text-primary')}>{label}</span>
      </div>
      {!done ? (
        <Button variant="secondary" size="sm" asChild>
          <Link href={href}>{cta}</Link>
        </Button>
      ) : null}
    </li>
  );
}
