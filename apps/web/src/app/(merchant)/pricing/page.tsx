'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Plus, Tags } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { PricingTierModal } from '@/components/merchant/PricingTierModal';
import { useDeletePricingTier, usePricingTiers } from '@/hooks/usePricingTiers';
import { ApiClientError } from '@/lib/api/error';
import { formatMoney } from '@/lib/format';
import type { PricingTierSummary } from '@/types/api';

const TIER_TYPE_LABELS: Record<string, string> = {
  percentage_off: 'Percentage Off',
  fixed_price_list: 'Fixed Price List',
  volume_breaks: 'Volume Breaks',
};

/**
 * Pricing tiers admin. Tier cards expose Edit (modal), View buyers (filtered
 * buyers list), Manage overrides (tier detail), and Delete — guarded by the
 * assigned-buyer count (the API rejects deleting a tier with buyers via 409
 * TIER_HAS_ACTIVE_BUYERS, surfaced here as a disabled button + message). Create
 * uses the same modal. Empty state offers a single primary CTA.
 */
export default function PricingPage(): JSX.Element {
  const { data: tiers, isLoading } = usePricingTiers();
  const del = useDeletePricingTier();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PricingTierSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PricingTierSummary | null>(null);

  const openCreate = (): void => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (tier: PricingTierSummary): void => {
    setEditing(tier);
    setModalOpen(true);
  };

  const confirmDelete = (): void => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    del.mutate(target.id, {
      onSuccess: () => {
        toast.success(`${target.name} deleted`);
        setDeleteTarget(null);
      },
      onError: (error) => {
        setDeleteTarget(null);
        toast.error(error instanceof ApiClientError ? error.message : 'Delete failed');
      },
    });
  };

  const list = tiers ?? [];

  return (
    <>
      <PageHeader
        title="Pricing Tiers"
        description="Unlimited tiers: percentage, fixed price list, or volume breaks."
        actions={
          list.length > 0 ? (
            <Button variant="primary" size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              New tier
            </Button>
          ) : undefined
        }
      />

      {isLoading ? (
        <section className="panel">
          <LoadingSkeleton rows={4} columns={[3, 2, 1, 1, 1]} />
        </section>
      ) : list.length === 0 ? (
        <section className="panel flex flex-col items-center justify-center px-6 py-16 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
            <Tags className="h-6 w-6 text-gray-500" />
          </div>
          <h2 className="text-base font-semibold text-gray-900">No pricing tiers yet</h2>
          <p className="mt-1 max-w-sm text-sm text-gray-500">
            Pricing tiers control what each buyer pays. Create your first tier to start onboarding
            wholesale buyers.
          </p>
          <Button variant="primary" size="sm" className="mt-4" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Create your first tier
          </Button>
        </section>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((tier) => (
            <TierCard
              key={tier.id}
              tier={tier}
              onEdit={() => openEdit(tier)}
              onDelete={() => setDeleteTarget(tier)}
            />
          ))}
        </div>
      )}

      <PricingTierModal open={modalOpen} onOpenChange={setModalOpen} tier={editing} />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete this pricing tier?"
        description={
          deleteTarget ? (
            <span>
              {deleteTarget.name} will be permanently removed, along with its price overrides. This
              cannot be undone.
            </span>
          ) : null
        }
        confirmLabel="Delete"
        destructive
        isLoading={del.isPending}
        onConfirm={confirmDelete}
      />
    </>
  );
}

function TierCard({
  tier,
  onEdit,
  onDelete,
}: {
  tier: PricingTierSummary;
  onEdit: () => void;
  onDelete: () => void;
}): JSX.Element {
  const hasBuyers = tier.buyerCount > 0;

  return (
    <div className="panel flex flex-col p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-gray-900">{tier.name}</h3>
            {tier.isDefault ? <StatusBadge status="approved" label="Default" /> : null}
          </div>
          <p className="mt-0.5 text-xs text-gray-500">
            {TIER_TYPE_LABELS[tier.type] ?? tier.type}
          </p>
        </div>
        <StatusBadge
          status={tier.isActive ? 'approved' : 'cancelled'}
          label={tier.isActive ? 'Active' : 'Inactive'}
        />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <Stat label="Base Discount" value={tier.baseDiscountPct ? `${tier.baseDiscountPct}%` : '—'} />
        <Stat label="Min Order" value={tier.minOrderAmount ? formatMoney(tier.minOrderAmount) : '—'} />
        <Stat label="Buyers" value={String(tier.buyerCount)} />
        <Stat label="Priority" value={String(tier.priority)} />
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-200 pt-3">
        <Button variant="default" size="sm" onClick={onEdit}>
          Edit
        </Button>
        <Button variant="default" size="sm" asChild>
          <Link href={`/buyers?tier=${tier.id}`}>View buyers</Link>
        </Button>
        <Button variant="default" size="sm" asChild>
          <Link href={`/pricing/${tier.id}`}>Manage overrides</Link>
        </Button>
        <Button
          variant="default"
          size="sm"
          className="ml-auto"
          disabled={hasBuyers}
          title={hasBuyers ? 'Reassign buyers before deleting this tier' : undefined}
          onClick={onDelete}
        >
          Delete
        </Button>
      </div>
      {hasBuyers ? (
        <p className="mt-2 text-xs text-gray-400">
          {tier.buyerCount} buyer{tier.buyerCount === 1 ? '' : 's'} assigned — reassign before deleting.
        </p>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-label uppercase tracking-wider text-gray-500">{label}</dt>
      <dd className="font-mono tabular-nums text-gray-900">{value}</dd>
    </div>
  );
}
