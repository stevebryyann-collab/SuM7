'use client';

import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Link2 } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import {
  BuyerApprovalPanel,
  type BuyerPanelTarget,
} from '@/components/merchant/BuyerApprovalPanel';
import {
  useBuyers,
  usePendingApplications,
  useReinstateBuyer,
  useSuspendBuyer,
} from '@/hooks/useBuyers';
import { usePricingTiers } from '@/hooks/usePricingTiers';
import { ApiClientError } from '@/lib/api/error';
import { formatMoney, formatRelative } from '@/lib/format';
import type { BuyerApplication, BuyerSummary } from '@/types/api';

type BuyerTab = 'all' | 'pending' | 'approved' | 'suspended';

const BUYER_STATUS: Record<Exclude<BuyerTab, 'pending'>, string | undefined> = {
  all: undefined,
  approved: 'approved',
  suspended: 'suspended',
};

/**
 * Merchant buyers admin. One tabbed surface: Pending shows registration
 * applications (Review → approve/reject + audited PII reveal); All / Approved /
 * Suspended show buyer records (row → read-only view, with inline edit for
 * approved buyers). A filter bar adds pricing-tier filtering and company search;
 * Suspend / Reinstate are confirmed. Copy application link shares the buyer
 * apply URL.
 */
function BuyersView(): JSX.Element {
  const searchParams = useSearchParams();
  const initialTier = searchParams.get('tier') ?? 'all';
  const [tab, setTab] = useState<BuyerTab>('all');
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState<string>(initialTier);
  const [target, setTarget] = useState<BuyerPanelTarget | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [suspendTarget, setSuspendTarget] = useState<BuyerSummary | null>(null);
  const [reinstateTarget, setReinstateTarget] = useState<BuyerSummary | null>(null);

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
      toast.success('Application link copied');
    } catch {
      toast.error('Could not copy link');
    }
  };

  const confirmSuspend = (): void => {
    if (!suspendTarget) return;
    const targetBuyer = suspendTarget;
    suspend.mutate(targetBuyer.buyerId, {
      onSuccess: () => {
        toast.success(`${targetBuyer.companyName} suspended`);
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
    const targetBuyer = reinstateTarget;
    reinstate.mutate(targetBuyer.buyerId, {
      onSuccess: () => {
        toast.success(`${targetBuyer.companyName} reinstated`);
        setReinstateTarget(null);
      },
      onError: (error) => {
        setReinstateTarget(null);
        toast.error(error instanceof ApiClientError ? error.message : 'Reinstate failed');
      },
    });
  };

  return (
    <>
      <PageHeader
        title="Buyers"
        description="Review applications and manage approved buyers."
        actions={
          <Button variant="default" size="sm" onClick={() => void copyApplicationLink()}>
            <Link2 className="h-4 w-4" />
            Copy application link
          </Button>
        }
      />

      <section className="panel">
        <div className="flex flex-col gap-3 border-b border-gray-200 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs value={tab} onValueChange={(v) => setTab(v as BuyerTab)}>
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="pending">
                  Pending
                  {pendingCount > 0 ? (
                    <span className="ml-1.5 rounded-full bg-yellow-100 px-1.5 text-xs font-medium text-yellow-800">
                      {pendingCount}
                    </span>
                  ) : null}
                </TabsTrigger>
                <TabsTrigger value="approved">Approved</TabsTrigger>
                <TabsTrigger value="suspended">Suspended</TabsTrigger>
              </TabsList>
            </Tabs>
            <Input
              placeholder="Search company…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-56"
            />
          </div>
          {!isPending ? (
            <div className="flex flex-wrap items-center gap-3">
              <Select value={tierFilter} onValueChange={setTierFilter}>
                <SelectTrigger className="h-8 w-48">
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
            </div>
          ) : null}
        </div>

        {isPending ? (
          <PendingTable
            isLoading={applications.isLoading}
            rows={pendingRows}
            onOpen={openApplication}
          />
        ) : buyers.isLoading ? (
          <LoadingSkeleton rows={8} columns={[3, 2, 1, 2, 2, 1]} />
        ) : (
          <BuyersTable
            rows={rows}
            onView={openBuyer}
            onSuspend={setSuspendTarget}
            onReinstate={setReinstateTarget}
          />
        )}

        {!isPending && buyers.hasNextPage ? (
          <div className="flex justify-center border-t border-gray-200 py-3">
            <Button
              variant="default"
              size="sm"
              disabled={buyers.isFetchingNextPage}
              onClick={() => void buyers.fetchNextPage()}
            >
              {buyers.isFetchingNextPage ? <Spinner className="h-3.5 w-3.5" /> : null}
              Load more
            </Button>
          </div>
        ) : null}
      </section>

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
    </>
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
  if (isLoading) return <LoadingSkeleton rows={3} columns={[3, 2, 2, 1]} />;
  if (rows.length === 0) {
    return <p className="px-4 py-6 text-sm text-gray-500">No applications awaiting review.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Company</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Submitted</TableHead>
          <TableHead className="text-right">Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((app) => (
          <TableRow key={app.id} className="cursor-pointer hover:bg-blue-50" onClick={() => onOpen(app)}>
            <TableCell className="font-medium">{app.companyName}</TableCell>
            <TableCell className="text-gray-600">{app.email}</TableCell>
            <TableCell className="text-gray-600">{formatRelative(app.createdAt)}</TableCell>
            <TableCell className="text-right">
              <Button
                variant="primary"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen(app);
                }}
              >
                Review
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function BuyersTable({
  rows,
  onView,
  onSuspend,
  onReinstate,
}: {
  rows: BuyerSummary[];
  onView: (buyer: BuyerSummary) => void;
  onSuspend: (buyer: BuyerSummary) => void;
  onReinstate: (buyer: BuyerSummary) => void;
}): JSX.Element {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Company</TableHead>
          <TableHead>Tier</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Orders</TableHead>
          <TableHead className="text-right">Outstanding</TableHead>
          <TableHead>Last Order</TableHead>
          <TableHead className="text-right">Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={7} className="py-8 text-center text-sm text-gray-500">
              No buyers found.
            </TableCell>
          </TableRow>
        ) : (
          rows.map((buyer) => (
            <TableRow
              key={buyer.buyerId}
              className="cursor-pointer hover:bg-blue-50"
              onClick={() => onView(buyer)}
            >
              <TableCell>
                <div className="font-medium text-gray-900">{buyer.companyName}</div>
                <div className="text-xs text-gray-500">{buyer.email}</div>
              </TableCell>
              <TableCell className="text-gray-600">{buyer.pricingTierName ?? 'Default'}</TableCell>
              <TableCell>
                <StatusBadge status={buyer.approvalStatus} />
              </TableCell>
              <TableCell className="text-right tabular-nums">{buyer.orderCount}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {formatMoney(buyer.outstandingInvoiceTotal)}
              </TableCell>
              <TableCell className="text-gray-600">{formatRelative(buyer.lastOrderAt)}</TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant="default"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onView(buyer);
                    }}
                  >
                    View
                  </Button>
                  {buyer.approvalStatus === 'suspended' ? (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onReinstate(buyer);
                      }}
                    >
                      Reinstate
                    </Button>
                  ) : (
                    <Button
                      variant="default"
                      size="sm"
                      disabled={buyer.approvalStatus !== 'approved'}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSuspend(buyer);
                      }}
                    >
                      Suspend
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

export default function BuyersPage(): JSX.Element {
  // useSearchParams requires a Suspense boundary in the App Router.
  return (
    <Suspense fallback={<LoadingSkeleton rows={8} columns={[3, 2, 1, 2, 2, 1]} />}>
      <BuyersView />
    </Suspense>
  );
}
