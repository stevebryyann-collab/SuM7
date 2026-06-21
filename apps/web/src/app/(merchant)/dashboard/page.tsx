'use client';

import Link from 'next/link';
import { ArrowRight, Check, CircleDashed } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { DashboardKpiCard } from '@/components/merchant/DashboardKpiCard';
import { ArAgingChart } from '@/components/merchant/ArAgingChart';
import { GmvTrendChart } from '@/components/merchant/GmvTrendChart';
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
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton';
import { useDashboard } from '@/hooks/useDashboard';
import { formatMoney, formatDate, formatRelative } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * Merchant dashboard. A single aggregator request (`GET /api/v1/dashboard`)
 * powers the KPI cards, AR-aging chart, 30-day GMV trend, recent invoices and
 * pending-applications panels. For a freshly-installed store the trial banner +
 * Get Started checklist lead (the checklist steps reflect live onboarding
 * flags); once subscribed the checklist retires. KPI figures fall back to $0
 * cleanly, so the empty state is just the zeroed dashboard plus the checklist.
 */
export default function DashboardPage(): JSX.Element {
  const { data, isLoading, isError } = useDashboard();

  const kpis = data?.kpis;
  const setup = data?.setup;
  const hasTier = setup?.hasTier ?? false;
  const hasApprovedBuyer = setup?.hasApprovedBuyer ?? false;
  const hasSubscription = setup?.hasSubscription ?? false;
  const setupComplete = hasTier && hasApprovedBuyer && hasSubscription;

  const invoices = data?.recentInvoices ?? [];
  const pending = data?.pendingApplications ?? [];
  const trend = data?.gmvTrend ?? [];
  const aging = data?.aging;

  if (isError) {
    return (
      <>
        <PageHeader title="Dashboard" description="Receivables and order activity at a glance." />
        <div className="panel p-8 text-center text-sm text-red-700">
          Dashboard failed to load. Refresh to try again.
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Dashboard" description="Receivables and order activity at a glance." />

      {/* Trial banner — until the merchant subscribes. */}
      {!isLoading && !hasSubscription ? (
        <div className="panel mb-6 flex flex-col gap-3 border-accent-dark/30 bg-accent/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900">You&apos;re on the 14-day free trial.</p>
            <p className="text-sm text-gray-500">Choose a plan to keep your portal active after the trial ends.</p>
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
        <section className="panel mb-6 p-5">
          <h2 className="text-base font-semibold text-gray-900">Get started</h2>
          <p className="mt-0.5 text-sm text-gray-500">A few steps to start taking wholesale orders.</p>
          <ol className="mt-4 space-y-2">
            <ChecklistItem done={hasTier} label="Create your first pricing tier" href="/pricing" cta="Set up pricing" />
            <ChecklistItem done={hasApprovedBuyer} label="Approve your first buyer" href="/buyers" cta="Review applications" />
            <ChecklistItem done={hasSubscription} label="Choose a subscription plan" href="/settings/billing" cta="Choose a plan" />
          </ol>
        </section>
      ) : null}

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {isLoading || !kpis ? (
          <KpiSkeletons />
        ) : (
          <>
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
              subLabel={`across ${kpis.outstandingInvoiceCount} invoice${kpis.outstandingInvoiceCount === 1 ? '' : 's'}`}
              link="/invoices"
            />
            <DashboardKpiCard
              title="Overdue Invoices"
              value={formatMoney(kpis.overdueInvoiceAmount)}
              badgeCount={kpis.overdueInvoiceCount}
              badgePulse={kpis.overdueInvoiceCount > 0}
              tone="danger"
              link="/invoices?agingBucket=1-30"
            />
            <DashboardKpiCard
              title="New Buyers"
              value={String(kpis.newBuyersThisMonth)}
              subLabel={`${kpis.pendingApplicationCount} application${kpis.pendingApplicationCount === 1 ? '' : 's'} pending`}
              link="/buyers"
            />
          </>
        )}
      </div>

      {/* AR aging + GMV trend */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="panel p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-label uppercase tracking-wider text-gray-500">AR Aging</h2>
            <Link href="/invoices/ar-aging" className="text-xs text-accent hover:underline">
              View full AR report →
            </Link>
          </div>
          {isLoading || !aging ? <LoadingSkeleton rows={5} columns={[2, 5]} /> : <ArAgingChart data={aging} />}
        </section>
        <section className="panel p-5">
          <h2 className="mb-4 text-label uppercase tracking-wider text-gray-500">GMV Trend</h2>
          {isLoading ? <LoadingSkeleton rows={6} columns={[1]} /> : <GmvTrendChart data={trend} />}
        </section>
      </div>

      {/* Recent Invoices + Pending Applications */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="panel">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
            <h2 className="text-label uppercase tracking-wider text-gray-500">Recent Invoices</h2>
            <Link href="/invoices" className="text-xs text-accent hover:underline">
              View all
            </Link>
          </div>
          {isLoading ? (
            <LoadingSkeleton rows={5} columns={[2, 3, 1, 2]} />
          ) : invoices.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500">No invoices yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Buyer</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-mono text-xs text-gray-700">{inv.invoiceNumber}</TableCell>
                    <TableCell className="max-w-[140px] truncate text-gray-700">{inv.buyerCompanyName ?? '—'}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatMoney(inv.total)}</TableCell>
                    <TableCell className="text-gray-600">{formatDate(inv.dueDate)}</TableCell>
                    <TableCell>
                      <StatusBadge status={inv.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="default" size="sm" asChild>
                        <Link href={`/invoices/${inv.id}`}>View</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>

        <section className="panel">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
            <h2 className="text-label uppercase tracking-wider text-gray-500">Pending Applications</h2>
            <Link href="/buyers" className="text-xs text-accent hover:underline">
              View all pending →
            </Link>
          </div>
          {isLoading ? (
            <LoadingSkeleton rows={3} columns={[3, 2, 2]} />
          ) : pending.length === 0 ? (
            <div className="flex items-center gap-2 px-4 py-6 text-sm text-gray-500">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-green-100 text-green-700">
                <Check className="h-3.5 w-3.5" />
              </span>
              No pending applications
            </div>
          ) : (
            <ul className="divide-y divide-gray-200">
              {pending.map((app) => (
                <li key={app.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">{app.companyName}</p>
                    <p className="truncate text-xs text-gray-500">
                      {app.businessType ?? 'Business'} · Applied {formatRelative(app.createdAt)}
                    </p>
                  </div>
                  <Button variant="primary" size="sm" asChild>
                    <Link href="/buyers">Review</Link>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
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
    <li className="flex items-center justify-between gap-4 rounded-md border border-gray-200 px-3 py-2.5">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
            done ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400',
          )}
        >
          {done ? <Check className="h-3.5 w-3.5" /> : <CircleDashed className="h-3.5 w-3.5" />}
        </span>
        <span className={cn('text-sm', done ? 'text-gray-500 line-through' : 'text-gray-900')}>{label}</span>
      </div>
      {!done ? (
        <Button variant="default" size="sm" asChild>
          <Link href={href}>{cta}</Link>
        </Button>
      ) : null}
    </li>
  );
}

function KpiSkeletons(): JSX.Element {
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-lg border border-gray-200 bg-white p-5">
          <LoadingSkeleton rows={2} columns={[2]} />
        </div>
      ))}
    </>
  );
}
