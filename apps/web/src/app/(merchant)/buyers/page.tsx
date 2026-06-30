'use client';

import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Check, Clipboard, Search, Users } from 'lucide-react';
import { PageLayout, PageContainer } from '@/components/merchant/PageLayout';
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
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip } from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { BuyerTableSkeleton } from '@/components/shared/LoadingSkeleton';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { toast } from '@/components/shared/toasts';
import {
  BuyerApprovalPanel,
  type BuyerPanelTarget,
} from '@/components/merchant/BuyerApprovalPanel';
import {
  useBuyers,
  usePendingApplications,
  useReinstateBuyer,
  useSuspendBuyer,
  useBuyerGdprExport,
  useEraseBuyer,
} from '@/hooks/useBuyers';
import { usePricingTiers } from '@/hooks/usePricingTiers';
import { ApiClientError } from '@/lib/api/error';
import { formatMoney, formatRelative } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { BuyerApplication, BuyerSummary } from '@/types/api';

type BuyerTab = 'all' | 'pending' | 'approved' | 'suspended';

const BUYER_STATUS: Record<Exclude<BuyerTab, 'pending'>, string | undefined> = {
  all: undefined,
  approved: 'approved',
  suspended: 'suspended',
};

const VALID_TABS: BuyerTab[] = ['all', 'pending', 'approved', 'suspended'];

function initialTab(status: string | null): BuyerTab {
  return status && (VALID_TABS as string[]).includes(status) ? (status as BuyerTab) : 'all';
}

/**
 * Merchant buyers admin. One tabbed surface: Pending shows registration
 * applications (Review → approve/reject + audited PII reveal); All / Approved /
 * Suspended show buyer records with a per-row {@link DropdownMenu} (Review, View
 * orders, Adjust tier, Suspend/Reinstate, and owner-only GDPR export/erase). A
 * Credit Utilization column shows AR consumed against each buyer's credit limit.
 * Copy application link shares the buyer apply URL. Tab is also settable via the
 * `status` query the dashboard links use.
 */
function BuyersView(): JSX.Element {
  const searchParams = useSearchParams();
  const initialTier = searchParams.get('tier') ?? 'all';
  const [tab, setTab] = useState<BuyerTab>(() => initialTab(searchParams.get('status')));
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState<string>(initialTier);
  const [target, setTarget] = useState<BuyerPanelTarget | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [suspendTarget, setSuspendTarget] = useState<BuyerSummary | null>(null);
  const [reinstateTarget, setReinstateTarget] = useState<BuyerSummary | null>(null);
  const [eraseTarget, setEraseTarget] = useState<BuyerSummary | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: session } = useSession();
  const isOwner = session?.role === 'owner';
  const applications = usePendingApplications();
  const { data: tiers } = usePricingTiers();
  const isPending = tab === 'pending';
  const buyers = useBuyers({
    approvalStatus: isPending ? undefined : BUYER_STATUS[tab],
    pricingTierId: tierFilter === 'all' ? undefined : tierFilter,
    searchQuery: search.trim() || undefined,
  });
  const suspend = useSuspendBuyer();
  const reinstate = useReinstateBuyer();
  const gdprExport = useBuyerGdprExport();
  const erase = useEraseBuyer();

  const rows = useMemo<BuyerSummary[]>(
    () => (buyers.data?.pages ?? []).flatMap((page) => page.data),
    [buyers.data],
  );

  const pendingCount = applications.data?.length ?? 0;
  const pendingRows = useMemo<BuyerApplication[]>(() => {
    const term = search.trim().toLowerCase();
    const list = applications.data ?? [];
    return term
      ? list.filter(
          (a) =>
            a.companyName.toLowerCase().includes(term) || a.email.toLowerCase().includes(term),
        )
      : list;
  }, [applications.data, search]);

  const openApplication = (application: BuyerApplication): void => {
    setTarget({ kind: 'application', application });
    setPanelOpen(true);
  };

  const openBuyer = (buyer: BuyerSummary): void => {
    setTarget({ kind: 'buyer', buyerId: buyer.buyerId, companyName: buyer.companyName });
    setPanelOpen(true);
  };

  const copyApplicationLink = async (): Promise<void> => {
    const url =
      typeof window !== 'undefined' ? `${window.location.origin}/portal/apply` : '/portal/apply';
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy link');
    }
  };

  const runGdprExport = (buyer: BuyerSummary): void => {
    gdprExport.mutate(buyer.buyerId, {
      onSuccess: () => toast.success(`GDPR export downloaded for ${buyer.companyName}`),
      onError: (error) =>
        toast.error(error instanceof ApiClientError ? error.message : 'GDPR export failed'),
    });
  };

  const confirmSuspend = (): void => {
    if (!suspendTarget) return;
    const buyer = suspendTarget;
    suspend.mutate(buyer.buyerId, {
      onSuccess: () => {
        toast.success(`${buyer.companyName} suspended`);
        setSuspendTarget(null);
      },
      onError: (error) => {
        setSuspendTarget(null);
        toast.error(error instanceof ApiClientError ? error.message : 'Suspend failed');
      },
    });
  };

  const confirmReinstate = (): void => {
    if (!reinstateTarget) return;
    const buyer = reinstateTarget;
    reinstate.mutate(buyer.buyerId, {
      onSuccess: () => {
        toast.success(`${buyer.companyName} reinstated`);
        setReinstateTarget(null);
      },
      onError: (error) => {
        setReinstateTarget(null);
        toast.error(error instanceof ApiClientError ? error.message : 'Reinstate failed');
      },
    });
  };

  const confirmErase = (): void => {
    if (!eraseTarget) return;
    const buyer = eraseTarget;
    erase.mutate(buyer.buyerId, {
      onSuccess: () => {
        toast.success(`${buyer.companyName} erased`);
        setEraseTarget(null);
      },
      onError: (error) => {
        setEraseTarget(null);
        toast.error(error instanceof ApiClientError ? error.message : 'Erase failed');
      },
    });
  };

  return (
    <PageLayout
      title="Buyers"
      subtitle="Review applications and manage approved buyers."
      headerActions={
        <Button variant="secondary" size="sm" onClick={() => void copyApplicationLink()}>
          {copied ? <Check className="h-4 w-4 text-success" /> : <Clipboard className="h-4 w-4" />}
          {copied ? 'Copied' : 'Copy application link'}
        </Button>
      }
    >
      {/* Tabs + search */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as BuyerTab)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="pending">
              <span className="flex items-center gap-1.5">
                Pending
                {pendingCount > 0 ? (
                  <>
                    <span className="rounded-full border border-border-strong bg-warning-bg px-1.5 text-2xs font-medium text-warning">
                      {pendingCount}
                    </span>
                    <span className="relative flex h-2 w-2" aria-hidden>
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warning opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-warning" />
                    </span>
                  </>
                ) : null}
              </span>
            </TabsTrigger>
            <TabsTrigger value="approved">Approved</TabsTrigger>
            <TabsTrigger value="suspended">Suspended</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
            <Input
              placeholder="Search company…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-56 pl-9"
            />
          </div>
          {!isPending ? (
            <Select value={tierFilter} onValueChange={setTierFilter}>
              <SelectTrigger className="h-9 w-44">
                <SelectValue placeholder="All tiers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All tiers</SelectItem>
                {(tiers ?? []).map((tier) => (
                  <SelectItem key={tier.id} value={tier.id}>
                    {tier.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
      </div>

      {isPending ? (
        <PendingTable
          isLoading={applications.isLoading}
          rows={pendingRows}
          onOpen={openApplication}
        />
      ) : buyers.isLoading ? (
        <BuyerTableSkeleton rows={8} />
      ) : (
        <BuyersTable
          rows={rows}
          isOwner={isOwner}
          onView={openBuyer}
          onSuspend={setSuspendTarget}
          onReinstate={setReinstateTarget}
          onGdprExport={runGdprExport}
          onErase={setEraseTarget}
        />
      )}

      {!isPending && buyers.hasNextPage ? (
        <div className="mt-4 flex justify-center">
          <Button
            variant="secondary"
            size="sm"
            disabled={buyers.isFetchingNextPage}
            onClick={() => void buyers.fetchNextPage()}
          >
            {buyers.isFetchingNextPage ? <Spinner className="h-3.5 w-3.5" /> : null}
            Load more
          </Button>
        </div>
      ) : null}

      <BuyerApprovalPanel target={target} open={panelOpen} onOpenChange={setPanelOpen} />

      <ConfirmDialog
        open={suspendTarget !== null}
        onOpenChange={(open) => !open && setSuspendTarget(null)}
        title="Suspend this buyer?"
        description={
          suspendTarget ? (
            <span>
              {suspendTarget.companyName} will immediately lose portal access. You can reinstate them later.
            </span>
          ) : null
        }
        confirmLabel="Suspend"
        destructive
        isLoading={suspend.isPending}
        onConfirm={confirmSuspend}
      />

      <ConfirmDialog
        open={reinstateTarget !== null}
        onOpenChange={(open) => !open && setReinstateTarget(null)}
        title="Reinstate this buyer?"
        description={
          reinstateTarget ? (
            <span>{reinstateTarget.companyName} will regain portal access and return to approved status.</span>
          ) : null
        }
        confirmLabel="Reinstate"
        isLoading={reinstate.isPending}
        onConfirm={confirmReinstate}
      />

      <ConfirmDialog
        open={eraseTarget !== null}
        onOpenChange={(open) => !open && setEraseTarget(null)}
        title="Erase this buyer (GDPR)?"
        description={
          eraseTarget ? (
            <span>
              {eraseTarget.companyName} will be permanently anonymized and their account unlinked. This cannot be
              undone, and is refused while unpaid invoices remain.
            </span>
          ) : null
        }
        confirmLabel="Erase permanently"
        destructive
        isLoading={erase.isPending}
        onConfirm={confirmErase}
      />
    </PageLayout>
  );
}

/** AR consumed against a buyer's credit limit, or null when the relationship is uncapped. */
function utilization(buyer: BuyerSummary): { pct: number; used: number; limit: number } | null {
  const limit = buyer.creditLimit ? Number(buyer.creditLimit) : null;
  if (!limit || limit <= 0) return null;
  const used = Number(buyer.outstandingInvoiceTotal) || 0;
  return { pct: Math.round((used / limit) * 100), used, limit };
}

function CreditUtilizationCell({ buyer }: { buyer: BuyerSummary }): JSX.Element {
  const util = utilization(buyer);
  if (!util) return <span className="text-xs text-text-tertiary">No limit</span>;

  const fill = util.pct >= 90 ? 'bg-danger' : util.pct >= 70 ? 'bg-warning' : 'bg-success';
  return (
    <Tooltip content={`${formatMoney(util.used)} of ${formatMoney(util.limit)} used`}>
      <span className="inline-flex items-center gap-2">
        <span className="tabular-nums text-text-primary">{util.pct}%</span>
        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-neutral-bg">
          <span className={cn('block h-full rounded-full', fill)} style={{ width: `${Math.min(util.pct, 100)}%` }} />
        </span>
      </span>
    </Tooltip>
  );
}

function PendingTable({
  isLoading,
  rows,
  onOpen,
}: {
  isLoading: boolean;
  rows: BuyerApplication[];
  onOpen: (application: BuyerApplication) => void;
}): JSX.Element {
  if (isLoading) return <BuyerTableSkeleton rows={4} />;
  return (
    <DataTable>
      <DataTableHeader>
        <tr>
          <DataTableHeaderCell>Company</DataTableHeaderCell>
          <DataTableHeaderCell>Email</DataTableHeaderCell>
          <DataTableHeaderCell>Submitted</DataTableHeaderCell>
          <DataTableHeaderCell align="right">Action</DataTableHeaderCell>
        </tr>
      </DataTableHeader>
      <DataTableBody>
        {rows.length === 0 ? (
          <DataTableEmpty
            colSpan={4}
            icon={<Users className="h-6 w-6" />}
            title="No applications awaiting review"
            message="New wholesale applications will appear here for approval."
          />
        ) : (
          rows.map((app) => (
            <DataTableRow key={app.id} clickable onClick={() => onOpen(app)}>
              <DataTableCell className="font-medium">{app.companyName}</DataTableCell>
              <DataTableCell className="text-text-secondary">{app.email}</DataTableCell>
              <DataTableCell className="text-text-secondary">{formatRelative(app.createdAt)}</DataTableCell>
              <DataTableCell align="right" onClick={(e) => e.stopPropagation()}>
                <Button variant="primary" size="sm" onClick={() => onOpen(app)}>
                  Review
                </Button>
              </DataTableCell>
            </DataTableRow>
          ))
        )}
      </DataTableBody>
    </DataTable>
  );
}

function BuyersTable({
  rows,
  isOwner,
  onView,
  onSuspend,
  onReinstate,
  onGdprExport,
  onErase,
}: {
  rows: BuyerSummary[];
  isOwner: boolean;
  onView: (buyer: BuyerSummary) => void;
  onSuspend: (buyer: BuyerSummary) => void;
  onReinstate: (buyer: BuyerSummary) => void;
  onGdprExport: (buyer: BuyerSummary) => void;
  onErase: (buyer: BuyerSummary) => void;
}): JSX.Element {
  return (
    <DataTable>
      <DataTableHeader>
        <tr>
          <DataTableHeaderCell>Company</DataTableHeaderCell>
          <DataTableHeaderCell>Tier</DataTableHeaderCell>
          <DataTableHeaderCell>Status</DataTableHeaderCell>
          <DataTableHeaderCell align="right">Orders</DataTableHeaderCell>
          <DataTableHeaderCell align="right">Outstanding</DataTableHeaderCell>
          <DataTableHeaderCell>Credit Utilization</DataTableHeaderCell>
          <DataTableHeaderCell>Last Order</DataTableHeaderCell>
          <DataTableHeaderCell align="right">Actions</DataTableHeaderCell>
        </tr>
      </DataTableHeader>
      <DataTableBody>
        {rows.length === 0 ? (
          <DataTableEmpty
            colSpan={8}
            icon={<Users className="h-6 w-6" />}
            title="No buyers found"
            message="Approved buyers will appear here."
          />
        ) : (
          rows.map((buyer) => (
            <DataTableRow key={buyer.buyerId} clickable onClick={() => onView(buyer)}>
              <DataTableCell>
                <div className="font-medium text-text-primary">{buyer.companyName}</div>
                <div className="text-xs text-text-secondary">{buyer.email}</div>
              </DataTableCell>
              <DataTableCell className="text-text-secondary">{buyer.pricingTierName ?? 'Default'}</DataTableCell>
              <DataTableCell>
                <StatusBadge status={buyer.approvalStatus} />
              </DataTableCell>
              <DataTableCell align="right">{buyer.orderCount}</DataTableCell>
              <DataTableCell align="right" className="font-mono">
                {formatMoney(buyer.outstandingInvoiceTotal)}
              </DataTableCell>
              <DataTableCell>
                <CreditUtilizationCell buyer={buyer} />
              </DataTableCell>
              <DataTableCell className="text-text-secondary">{formatRelative(buyer.lastOrderAt)}</DataTableCell>
              <DataTableCell align="right" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-end">
                  <DropdownMenu label={`Actions for ${buyer.companyName}`}>
                    <DropdownMenuItem onSelect={() => onView(buyer)}>Review</DropdownMenuItem>
                    <DropdownMenuItem href={`/orders?buyerId=${buyer.buyerId}`}>View orders</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onView(buyer)}>Adjust tier</DropdownMenuItem>
                    {buyer.approvalStatus === 'suspended' ? (
                      <DropdownMenuItem onSelect={() => onReinstate(buyer)}>Reinstate</DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        disabled={buyer.approvalStatus !== 'approved'}
                        onSelect={() => onSuspend(buyer)}
                      >
                        Suspend
                      </DropdownMenuItem>
                    )}
                    {isOwner ? (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => onGdprExport(buyer)}>GDPR export</DropdownMenuItem>
                        <DropdownMenuItem destructive onSelect={() => onErase(buyer)}>
                          GDPR erase
                        </DropdownMenuItem>
                      </>
                    ) : null}
                  </DropdownMenu>
                </div>
              </DataTableCell>
            </DataTableRow>
          ))
        )}
      </DataTableBody>
    </DataTable>
  );
}

export default function BuyersPage(): JSX.Element {
  // useSearchParams requires a Suspense boundary in the App Router.
  return (
    <Suspense
      fallback={
        <PageContainer>
          <BuyerTableSkeleton rows={8} />
        </PageContainer>
      }
    >
      <BuyersView />
    </Suspense>
  );
}
