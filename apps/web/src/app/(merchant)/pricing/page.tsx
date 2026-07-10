'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp, Info, Plus, Tags, X } from 'lucide-react';
import { PageLayout } from '@/components/merchant/PageLayout';
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
import { StatusBadge } from '@/components/shared/StatusBadge';
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton';
import { FadeIn } from '@/components/shared/FadeIn';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { PricingTierModal } from '@/components/merchant/PricingTierModal';
import {
  useDeletePricingTier,
  usePricingTiers,
  useUpdatePricingTier,
} from '@/hooks/usePricingTiers';
import { ApiClientError } from '@/lib/api/error';
import { cn } from '@/lib/cn';
import type { PricingTierSummary } from '@/types/api';

const TIER_TYPE_LABELS: Record<string, string> = {
  percentage_off: 'Percentage Off',
  fixed_price_list: 'Fixed Price List',
  volume_breaks: 'Volume Breaks',
};

/** Small inline type badge — distinct from {@link StatusBadge} per the design spec. */
const TYPE_BADGE: Record<string, { label: string; className: string }> = {
  percentage_off: { label: '% Off', className: 'bg-accent-subtle text-accent' },
  volume_breaks: { label: 'Volume', className: 'bg-purple-50 text-purple-700' },
  fixed_price_list: { label: 'Fixed', className: 'bg-orange-50 text-orange-700' },
};

const INFO_DISMISSED_KEY = 'pricing_info_dismissed';
const COLUMN_COUNT = 7;

/** The scannable "what does this tier actually do" cell — one line, type-specific. */
function tierDetails(tier: PricingTierSummary): string {
  switch (tier.type) {
    case 'percentage_off':
      return tier.baseDiscountPct ? `${Number(tier.baseDiscountPct)}% off all products` : '—';
    case 'volume_breaks': {
      const brackets = tier.conditionsJson?.brackets ?? [];
      if (brackets.length === 0) return 'No brackets configured';
      const from = brackets[0]?.discountPct;
      return `${brackets.length} bracket${brackets.length === 1 ? '' : 's'}${
        from !== undefined ? ` — from ${from}% off` : ''
      }`;
    }
    case 'fixed_price_list':
      return `${tier.overrideCount} override${tier.overrideCount === 1 ? '' : 's'} configured`;
    default:
      return '—';
  }
}

/**
 * Pricing tiers admin. A dense, scannable table (replacing the earlier card
 * grid) — one row per tier: type, an at-a-glance details cell, buyer count,
 * default status, priority (reorder via swap-with-neighbor), and actions.
 * Create/edit still goes through {@link PricingTierModal}; delete is guarded
 * by assigned-buyer count exactly as before (409 TIER_HAS_ACTIVE_BUYERS).
 */
export default function PricingPage(): JSX.Element {
  const { data: tiers, isLoading } = usePricingTiers();
  const del = useDeletePricingTier();
  const update = useUpdatePricingTier();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PricingTierSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PricingTierSummary | null>(null);

  // Start hidden; reveal only after confirming no prior dismissal, avoiding an
  // SSR/first-paint flash of an already-dismissed banner (same pattern as
  // FirstUseWelcome).
  const [bannerVisible, setBannerVisible] = useState(false);
  useEffect(() => {
    if (localStorage.getItem(INFO_DISMISSED_KEY) !== '1') setBannerVisible(true);
  }, []);
  const dismissBanner = (): void => {
    localStorage.setItem(INFO_DISMISSED_KEY, '1');
    setBannerVisible(false);
  };

  const openCreate = (): void => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (tier: PricingTierSummary): void => {
    setEditing(tier);
    setModalOpen(true);
  };

  const setDefault = (tier: PricingTierSummary): void => {
    if (tier.isDefault) return;
    update.mutate(
      { id: tier.id, input: { isDefault: true } },
      {
        onSuccess: () => toast.success(`${tier.name} is now the default tier`),
        onError: (error) =>
          toast.error(error instanceof ApiClientError ? error.message : 'Could not set default tier'),
      },
    );
  };

  const swapPriority = (a: PricingTierSummary, b: PricingTierSummary): void => {
    update.mutate({ id: a.id, input: { priority: b.priority } });
    update.mutate({ id: b.id, input: { priority: a.priority } });
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
    <PageLayout
      title="Pricing Tiers"
      subtitle="Unlimited tiers: percentage, fixed price list, or volume breaks."
      action={list.length > 0 ? { label: 'New tier', onClick: openCreate, icon: Plus } : undefined}
    >
      {bannerVisible && list.length > 0 ? (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-accent-border bg-accent-subtle p-4">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" aria-hidden />
          <p className="min-w-0 flex-1 text-sm text-text-secondary">
            Buyers are assigned your default tier when approved. You can change any buyer&apos;s tier
            individually from the Buyers page.
          </p>
          <button
            type="button"
            onClick={dismissBanner}
            aria-label="Dismiss"
            className="flex-shrink-0 rounded-md p-1 text-text-tertiary transition-colors duration-fast hover:bg-surface hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {isLoading ? (
        <section className="panel">
          <LoadingSkeleton rows={4} columns={[3, 2, 1, 1, 1]} />
        </section>
      ) : list.length === 0 ? (
        <section className="panel flex flex-col items-center justify-center px-6 py-16 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-fog-soft">
            <Tags className="h-6 w-6 text-text-secondary" />
          </div>
          <h2 className="text-base font-semibold text-text-primary">No pricing tiers yet</h2>
          <p className="mt-1 max-w-sm text-sm text-text-secondary">
            Pricing tiers control what each buyer pays. Create your first tier to start onboarding
            wholesale buyers.
          </p>
          <Button variant="primary" size="sm" className="mt-4" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Create your first tier
          </Button>
        </section>
      ) : (
        <FadeIn>
          <DataTable>
            <DataTableHeader>
              <tr>
                <DataTableHeaderCell>Tier Name</DataTableHeaderCell>
                <DataTableHeaderCell>Type</DataTableHeaderCell>
                <DataTableHeaderCell>Discount / Details</DataTableHeaderCell>
                <DataTableHeaderCell align="right">Buyers</DataTableHeaderCell>
                <DataTableHeaderCell>Default</DataTableHeaderCell>
                <DataTableHeaderCell align="right">Priority</DataTableHeaderCell>
                <DataTableHeaderCell align="right">Actions</DataTableHeaderCell>
              </tr>
            </DataTableHeader>
            <DataTableBody>
              {list.length === 0 ? (
                <DataTableEmpty colSpan={COLUMN_COUNT} title="No pricing tiers found" />
              ) : (
                list.map((tier, index) => {
                  const typeBadge = TYPE_BADGE[tier.type];
                  const hasBuyers = tier.buyerCount > 0;
                  return (
                    <DataTableRow key={tier.id} className="group">
                      <DataTableCell className="font-medium text-text-primary">{tier.name}</DataTableCell>
                      <DataTableCell>
                        <span
                          className={cn(
                            'inline-flex items-center rounded px-1.5 py-0.5 text-2xs font-medium',
                            typeBadge?.className ?? 'bg-neutral-bg text-neutral',
                          )}
                        >
                          {typeBadge?.label ?? TIER_TYPE_LABELS[tier.type] ?? tier.type}
                        </span>
                      </DataTableCell>
                      <DataTableCell className="text-text-secondary">{tierDetails(tier)}</DataTableCell>
                      <DataTableCell align="right" data-testid="financial-cell">
                        {tier.buyerCount}
                      </DataTableCell>
                      <DataTableCell>
                        {tier.isDefault ? (
                          <StatusBadge status="approved" label="Default" />
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="opacity-0 transition-opacity duration-fast group-hover:opacity-100"
                            disabled={update.isPending}
                            onClick={() => setDefault(tier)}
                          >
                            Set as default
                          </Button>
                        )}
                      </DataTableCell>
                      <DataTableCell align="right">
                        <div className="flex items-center justify-end gap-1">
                          <span className="font-mono tabular-nums text-text-secondary">{tier.priority}</span>
                          <button
                            type="button"
                            aria-label={`Move ${tier.name} up`}
                            disabled={index === 0 || update.isPending}
                            onClick={() => swapPriority(tier, list[index - 1]!)}
                            className="rounded text-text-tertiary transition-colors duration-fast hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Move ${tier.name} down`}
                            disabled={index === list.length - 1 || update.isPending}
                            onClick={() => swapPriority(tier, list[index + 1]!)}
                            className="rounded text-text-tertiary transition-colors duration-fast hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </DataTableCell>
                      <DataTableCell align="right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end">
                          <DropdownMenu label={`Actions for ${tier.name}`}>
                            <DropdownMenuItem onSelect={() => openEdit(tier)}>Edit</DropdownMenuItem>
                            <DropdownMenuItem href={`/pricing/${tier.id}`}>Manage overrides</DropdownMenuItem>
                            <DropdownMenuItem href={`/buyers?tier=${tier.id}`}>View buyers</DropdownMenuItem>
                            {!tier.isDefault ? (
                              <DropdownMenuItem onSelect={() => setDefault(tier)}>
                                Set as default
                              </DropdownMenuItem>
                            ) : null}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              destructive
                              disabled={hasBuyers}
                              title={hasBuyers ? 'Reassign buyers before deleting this tier' : undefined}
                              onSelect={() => setDeleteTarget(tier)}
                            >
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenu>
                        </div>
                      </DataTableCell>
                    </DataTableRow>
                  );
                })
              )}
            </DataTableBody>
          </DataTable>
        </FadeIn>
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
    </PageLayout>
  );
}
