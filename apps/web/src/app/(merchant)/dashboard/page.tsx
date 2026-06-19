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
import { useMerchantDashboard, useArAging } from '@/hooks/useMerchantDashboard';
import { usePricingTiers } from '@/hooks/usePricingTiers';
import { useBuyers, usePendingApplications } from '@/hooks/useBuyers';
import { useInvoices } from '@/hooks/useInvoices';
import { formatMoney, formatRelative } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { GmvTrendPoint, InvoiceSummary } from '@/types/api';

/**
 * Merchant dashboard. For a freshly-installed store it leads with a welcome +
 * Get Started checklist and a trial banner; once there's real activity it shows
 * KPI cards, AR aging, GMV trend, Recent Invoices and Pending Applications. The
 * checklist steps reflect live data (a tier exists, a buyer is approved) so they
 * tick off as the merchant completes setup.
 */
export default function DashboardPage(): JSX.Element {
  const { data: kpis, isLoading: kpisLoading, isError } = useMerchantDashboard();
  const { data: aging, isLoading: agingLoading } = useArAging();
  const { data: tiers } = usePricingTiers();
  const applications = usePendingApplications();
  const approvedBuyers = useBuyers({ approvalStatus: 'approved' });
  const recentInvoices = useInvoices({ mode: 'merchant' });

  const hasTier = (tiers?.length ?? 0) > 0;
  const hasApprovedBuyer =
    (approvedBuyers.data?.pages ?? []).some((page) => page.data.length > 0) ?? false;
  // Subscription state is not part of the Group 1 data set; treat it as pending
  // so the checklist surfaces the billing step (links to /settings/billing).
  const hasSubscription = false;
  const setupComplete = hasTier && hasApprovedBuyer && hasSubscription;

  const invoices: InvoiceSummary[] = (recentInvoices.data?.pages[0]?.data ?? []).slice(0, 5);
  const pending = applications.data ?? [];

  const trend: GmvTrendPoint[] = kpis
    ? [
        { date: monthStartIso(-1), gmv: kpis.gmvPreviousMonth },
        { date: monthStartIso(0), gmv: kpis.gmvCurrentMonth },
      ]
    : [];

  return (
    <>
      <PageHeader title="Dashboard" description="Receivables and order activity at a glance." />

      {/* Trial banner */}
      {!hasSubscription ? (
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

      {/* Get Started checklist (until setup is complete) */}
      {!setupComplete ? (
        <section className="panel mb-6 p-5">
          <h2 className="text-base font-semibold text-gray-900">Get started</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            A few steps to start taking wholesale orders.
          </p>
          <ol className="mt-4 space-y-2">
            <ChecklistItem
              done={hasTier}
              label="Create your first pricing tier"
              href="/pricing"
              cta="Set up pricing"
            />
            <ChecklistItem
              done={hasApprovedBuyer}
              label="Approve your first buyer"
              href="/buyers"
              cta="Review applications"
            />
            <ChecklistItem
              done={hasSubscription}
              label="Choose a subscription plan"
              href="/settings/billing"
              cta="Choose a plan"
            />
          </ol>
        </section>
      ) : null}

      {isError ? (
        <div className="panel p-6 text-sm text-red-700">Failed to load dashboard metrics.</div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {kpisLoading || !kpis ? (
              <KpiSkeletons />
            ) : (
              <>
                <DashboardKpiCard
                  title="GMV This Month"
                  value={formatMoney(kpis.gmvCurrentMonth)}
                  changePercent={kpis.gmvChangePercent}
                  changePeriod="vs last month"
                />
                <DashboardKpiCard
                  title="Outstanding AR"
                  value={formatMoney(kpis.outstandingArBalance)}
                  link="/invoices"
                />
                <DashboardKpiCard
                  title="Overdue Invoices"
                  value={formatMoney(kpis.overdueInvoiceAmount)}
                  badgeCount={kpis.overdueInvoiceCount}
                  badgePulse={kpis.overdueInvoiceCount > 0}
                  link="/invoices?agingBucket=1-30"
                />
                <DashboardKpiCard
                  title="New Buyers"
                  value={String(kpis.newBuyersThisMonth)}
                  badgeCount={kpis.pendingApplicationCount}
                  badgePulse={kpis.pendingApplicationCount > 0}
                  link="/buyers"
                />
              </>
            )}
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section className="panel p-5">
              <h2 className="mb-4 text-label uppercase tracking-wider text-gray-500">AR Aging</h2>
              {agingLoading || !aging ? (
                <LoadingSkeleton rows={5} columns={[2, 5]} />
              ) : (
                <ArAgingChart data={aging} />
              )}
            </section>
            <section className="panel p-5">
              <h2 className="mb-4 text-label uppercase tracking-wider text-gray-500">GMV Trend</h2>
              {kpisLoading || !kpis ? (
                <LoadingSkeleton rows={6} columns={[1]} />
              ) : (
                <GmvTrendChart data={trend} />
              )}
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
              {recentInvoices.isLoading ? (
                <LoadingSkeleton rows={5} columns={[2, 3, 1, 2]} />
              ) : invoices.length === 0 ? (
                <p className="px-4 py-6 text-sm text-gray-500">No invoices yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Buyer</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoices.map((inv) => (
                      <TableRow key={inv.id}>
                        <TableCell className="font-mono text-xs text-gray-700">{inv.invoiceNumber}</TableCell>
                        <TableCell className="max-w-[160px] truncate text-gray-700">
                          {inv.buyerCompanyName ?? '—'}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={inv.status} />
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatMoney(inv.total)}
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
                  View all
                </Link>
              </div>
              {applications.isLoading ? (
                <LoadingSkeleton rows={3} columns={[3, 2, 2]} />
              ) : pending.length === 0 ? (
                <p className="px-4 py-6 text-sm text-gray-500">No applications awaiting review.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Company</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Submitted</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pending.slice(0, 5).map((app) => (
                      <TableRow key={app.id}>
                        <TableCell className="font-medium text-gray-900">{app.companyName}</TableCell>
                        <TableCell className="max-w-[160px] truncate text-gray-600">{app.email}</TableCell>
                        <TableCell className="text-gray-600">{formatRelative(app.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </section>
          </div>
        </>
      )}
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
        <span className={cn('text-sm', done ? 'text-gray-500 line-through' : 'text-gray-900')}>
          {label}
        </span>
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

/** ISO timestamp for the first day of the month, `offset` months from now. */
function monthStartIso(offset: number): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + offset, 1).toISOString();
}
