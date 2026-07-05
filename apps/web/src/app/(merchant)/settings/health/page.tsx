'use client';

import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { PageLayout } from '@/components/merchant/PageLayout';
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton';
import {
  useSystemHealth,
  useWebhookStats,
  type BreakerState,
  type ServiceStatus,
} from '@/hooks/useHealth';
import { formatDateTime, formatRelative, number } from '@/lib/format';
import { cn } from '@/lib/cn';

const BREAKER_STYLES: Record<BreakerState, { label: string; className: string }> = {
  closed: { label: 'CLOSED', className: 'bg-success-bg text-success' },
  open: { label: 'OPEN', className: 'bg-danger-bg text-danger' },
  'half-open': { label: 'HALF-OPEN', className: 'bg-warning-bg text-warning' },
};

/**
 * Merchant System Health page (owner/admin). Composes the internal readiness,
 * circuit-breaker, queue, and webhook probes into a single live view so merchants
 * can see the platform is healthy — reliability made visible. Auto-refreshes every
 * 30s (react-query) with a manual "Refresh now" and a Last-updated stamp.
 */
export default function SystemHealthPage(): JSX.Element {
  const { data: session } = useSession();
  const role = session?.role ?? null;
  const authorized = role === 'owner' || role === 'admin';

  const health = useSystemHealth();
  const webhooks = useWebhookStats();

  const openBreakers = useMemo(
    () => (health.data?.breakers ?? []).filter((b) => b.state === 'open'),
    [health.data],
  );

  const refreshAll = (): void => {
    void health.refetch();
    void webhooks.refetch();
  };

  if (session && !authorized) {
    return (
      <PageLayout title="System Health" subtitle="Real-time status of your wholesale platform.">
        <div className="rounded-lg border border-border bg-surface p-8 text-center text-sm text-text-secondary shadow-sm">
          System Health is available to owners and admins only.
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="System Health"
      subtitle="Real-time status of your wholesale platform."
      action={{ label: 'Refresh now', onClick: refreshAll, icon: RefreshCw }}
      headerActions={
        health.data ? (
          <span className="text-xs text-text-tertiary">
            Last updated {formatDateTime(health.data.checkedAt)}
          </span>
        ) : undefined
      }
    >
      {openBreakers.length > 0 ? (
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-warning-border bg-warning-bg px-4 py-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            The {openBreakers.map((b) => b.name).join(', ')} integration
            {openBreakers.length > 1 ? 's are' : ' is'} experiencing issues. Orders and emails may be
            delayed. We&apos;re automatically retrying.
          </span>
        </div>
      ) : null}

      {health.isError ? (
        <div className="rounded-lg border border-border bg-surface p-8 text-center text-sm text-danger shadow-sm">
          Could not load system health. Refresh to try again.
        </div>
      ) : health.isLoading || !health.data ? (
        <div className="panel p-5">
          <LoadingSkeleton rows={6} columns={[2, 1, 1, 1]} />
        </div>
      ) : (
        <div className="space-y-6">
          <Section title="Core Services">
            <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
              <ServiceCell label="Database" status={health.data.services.database} />
              <ServiceCell label="Redis Cache" status={health.data.services.redisCache} />
              <ServiceCell label="Redis Queue" status={health.data.services.redisQueue} />
            </div>
          </Section>

          <Section title="Circuit Breakers">
            <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
              <div className="grid grid-cols-[1.5fr_1fr] gap-4 border-b border-border bg-neutral-bg px-4 py-2 text-2xs font-medium uppercase tracking-wider text-text-secondary sm:grid-cols-[1.5fr_1fr_repeat(3,minmax(0,0.7fr))]">
                <span>Integration</span>
                <span>State</span>
                <span className="hidden text-right sm:block">Fires</span>
                <span className="hidden text-right sm:block">Failures</span>
                <span className="hidden text-right sm:block">Timeouts</span>
              </div>
              {health.data.breakers.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-text-secondary">
                  No circuit breakers registered yet.
                </p>
              ) : (
                health.data.breakers.map((b) => (
                  <div
                    key={b.name}
                    className="grid grid-cols-[1.5fr_1fr] items-center gap-4 border-b border-border px-4 py-2.5 text-sm last:border-b-0 sm:grid-cols-[1.5fr_1fr_repeat(3,minmax(0,0.7fr))]"
                  >
                    <span className="font-medium capitalize text-text-primary">{b.name}</span>
                    <span>
                      <BreakerBadge state={b.state} />
                    </span>
                    <span className="hidden text-right font-mono tabular-nums text-text-secondary sm:block">
                      {number(b.stats.fires)}
                    </span>
                    <span className="hidden text-right font-mono tabular-nums text-text-secondary sm:block">
                      {number(b.stats.failures)}
                    </span>
                    <span className="hidden text-right font-mono tabular-nums text-text-secondary sm:block">
                      {number(b.stats.timeouts)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </Section>

          <Section title="Job Queue Health">
            <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
              <div className="grid grid-cols-[1.4fr_repeat(4,minmax(0,1fr))] gap-2 border-b border-border bg-neutral-bg px-4 py-2 text-2xs font-medium uppercase tracking-wider text-text-secondary">
                <span>Queue</span>
                <span className="text-right">Waiting</span>
                <span className="text-right">Active</span>
                <span className="text-right">Delayed</span>
                <span className="text-right">Dead Letter</span>
              </div>
              {health.data.queues.map((q) => {
                const dead = q.deadLetterDepth > 0;
                return (
                  <div
                    key={q.name}
                    className={cn(
                      'grid grid-cols-[1.4fr_repeat(4,minmax(0,1fr))] items-center gap-2 border-b border-border px-4 py-2.5 text-sm last:border-b-0',
                      dead && 'bg-danger-bg',
                    )}
                  >
                    <span className="font-medium text-text-primary">{q.name}</span>
                    <span className="text-right font-mono tabular-nums text-text-secondary">{number(q.waiting)}</span>
                    <span className="text-right font-mono tabular-nums text-text-secondary">{number(q.active)}</span>
                    <span className="text-right font-mono tabular-nums text-text-secondary">{number(q.delayed)}</span>
                    <span
                      className={cn(
                        'text-right font-mono tabular-nums',
                        dead ? 'font-semibold text-danger' : 'text-text-secondary',
                      )}
                    >
                      {number(q.deadLetterDepth)}
                    </span>
                  </div>
                );
              })}
              {health.data.queues.some((q) => q.deadLetterDepth > 0) ? (
                <p className="border-t border-border px-4 py-2 text-xs text-danger">
                  Jobs in dead letter require manual review. Contact support.
                </p>
              ) : null}
            </div>
          </Section>

          <Section title="Recent Webhook Processing">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <StatCard label="Received (24h)" value={webhooks.data ? number(webhooks.data.total) : '—'} />
              <StatCard label="Processed" value={webhooks.data ? number(webhooks.data.processed) : '—'} />
              <StatCard
                label="Failed"
                value={webhooks.data ? number(webhooks.data.failed) : '—'}
                danger={(webhooks.data?.failed ?? 0) > 0}
              />
              <StatCard
                label="Processing rate"
                value={
                  webhooks.data?.processingRatePct != null
                    ? `${webhooks.data.processingRatePct.toFixed(1)}%`
                    : '—'
                }
              />
              <StatCard
                label="Avg processing"
                value={webhooks.data?.avgProcessingMs != null ? `${number(webhooks.data.avgProcessingMs)}ms` : '—'}
              />
              <StatCard
                label="Last received"
                value={webhooks.data?.lastReceivedAt ? formatRelative(webhooks.data.lastReceivedAt) : 'None yet'}
              />
            </div>
          </Section>
        </div>
      )}
    </PageLayout>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section>
      <h2 className="mb-3 text-sm font-medium text-text-primary">{title}</h2>
      {children}
    </section>
  );
}

function ServiceCell({ label, status }: { label: string; status: ServiceStatus }): JSX.Element {
  const up = status === 'up';
  return (
    <div className="flex items-center justify-between bg-surface px-4 py-3">
      <span className="text-sm font-medium text-text-primary">{label}</span>
      <span className="inline-flex items-center gap-2 text-sm">
        <span className={cn('inline-block h-2.5 w-2.5 rounded-full', up ? 'bg-success' : 'bg-danger')} aria-hidden />
        <span className={up ? 'text-text-primary' : 'text-danger'}>{up ? 'Connected' : 'Unavailable'}</span>
      </span>
    </div>
  );
}

function BreakerBadge({ state }: { state: BreakerState }): JSX.Element {
  const s = BREAKER_STYLES[state];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide',
        s.className,
      )}
    >
      {s.label}
    </span>
  );
}

function StatCard({ label, value, danger }: { label: string; value: string; danger?: boolean }): JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-2xs font-medium uppercase tracking-wider text-text-secondary">{label}</p>
      <p className={cn('mt-1 text-xl font-semibold tabular-nums', danger ? 'text-danger' : 'text-text-primary')}>
        {value}
      </p>
    </div>
  );
}
