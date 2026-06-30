'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, Plus, Upload } from 'lucide-react';
import {
  PricingOverrideSchema,
  type BulkPricingOverrideInput,
} from '@b2b/shared/schemas';
import { PageHeader } from '@/components/shared/PageHeader';
import { PageContainer } from '@/components/merchant/PageLayout';
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
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { CursorPagination } from '@/components/shared/CursorPagination';
import { OverrideImportModal } from '@/components/merchant/OverrideImportModal';
import {
  useBulkOverrides,
  useDeleteOverride,
  usePricingTierDetail,
  useTierOverrides,
} from '@/hooks/usePricingTiers';
import { ApiClientError } from '@/lib/api/error';
import { formatMoney } from '@/lib/format';
import type { PricingOverrideSummary } from '@/types/api';

const TIER_TYPE_LABELS: Record<string, string> = {
  percentage_off: 'Percentage Off',
  fixed_price_list: 'Fixed Price List',
  volume_breaks: 'Volume Breaks',
};

interface AddOverrideDraft {
  shopifyProductId: string;
  shopifyVariantId: string;
  price: string;
  compareAtPrice: string;
}

const EMPTY_DRAFT: AddOverrideDraft = {
  shopifyProductId: '',
  shopifyVariantId: '',
  price: '',
  compareAtPrice: '',
};

/**
 * Pricing tier detail. Shows the tier header (+ volume-break conditions where
 * applicable) and manages per-variant price overrides: an inline add-override
 * form, a cursor-paginated override table with per-row delete (confirmed), and a
 * CSV import preview modal. All override writes go through the bulk-upsert and
 * single-delete endpoints; validation reuses the shared PricingOverrideSchema.
 */
export default function PricingTierDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const tierId = params.id;

  const detailQuery = usePricingTierDetail(tierId);
  const overridesQuery = useTierOverrides(tierId);
  const bulk = useBulkOverrides();
  const del = useDeleteOverride();

  const [pageIndex, setPageIndex] = useState(0);
  const [draft, setDraft] = useState<AddOverrideDraft>(EMPTY_DRAFT);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PricingOverrideSummary | null>(null);

  const detail = detailQuery.data;
  const pages = overridesQuery.data?.pages ?? [];
  const current = pages[pageIndex];
  const overrides: PricingOverrideSummary[] = useMemo(() => current?.data ?? [], [current]);

  const goNext = (): void => {
    if (pageIndex < pages.length - 1) {
      setPageIndex((i) => i + 1);
    } else if (overridesQuery.hasNextPage) {
      void overridesQuery.fetchNextPage().then(() => setPageIndex((i) => i + 1));
    }
  };

  const addOverride = (): void => {
    setDraftError(null);
    const candidate: Record<string, unknown> = {
      shopifyProductId: draft.shopifyProductId.trim(),
      price: draft.price.trim(),
    };
    if (draft.shopifyVariantId.trim()) candidate.shopifyVariantId = draft.shopifyVariantId.trim();
    if (draft.compareAtPrice.trim()) candidate.compareAtPrice = draft.compareAtPrice.trim();

    const parsed = PricingOverrideSchema.safeParse(candidate);
    if (!parsed.success) {
      setDraftError(parsed.error.issues[0]?.message ?? 'Invalid override');
      return;
    }
    const input: BulkPricingOverrideInput = { overrides: [parsed.data] };
    bulk.mutate(
      { id: tierId, input },
      {
        onSuccess: () => {
          toast.success('Override added');
          setDraft(EMPTY_DRAFT);
          setPageIndex(0);
        },
        onError: (error) =>
          toast.error(error instanceof ApiClientError ? error.message : 'Could not add override'),
      },
    );
  };

  const confirmDelete = (): void => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    del.mutate(
      { id: tierId, overrideId: target.id },
      {
        onSuccess: () => {
          toast.success('Override removed');
          setDeleteTarget(null);
          setPageIndex(0);
        },
        onError: (error) => {
          setDeleteTarget(null);
          toast.error(error instanceof ApiClientError ? error.message : 'Delete failed');
        },
      },
    );
  };

  return (
    <PageContainer>
      <Link
        href="/pricing"
        className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to pricing
      </Link>

      {detailQuery.isLoading || !detail ? (
        <section className="panel">
          <LoadingSkeleton rows={6} columns={[3, 2, 1, 1]} />
        </section>
      ) : (
        <>
          <PageHeader
            title={detail.name}
            description={`${TIER_TYPE_LABELS[detail.type] ?? detail.type} · ${detail.buyerCount} buyer${detail.buyerCount === 1 ? '' : 's'}`}
            actions={
              <Button variant="default" size="sm" onClick={() => setImportOpen(true)}>
                <Upload className="h-4 w-4" />
                Import CSV
              </Button>
            }
          />

          {/* Summary + conditions */}
          <section className="panel mb-6 p-4">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat
                label="Base Discount"
                value={detail.baseDiscountPct ? `${detail.baseDiscountPct}%` : '—'}
              />
              <Stat
                label="Min Order"
                value={detail.minOrderAmount ? formatMoney(detail.minOrderAmount) : '—'}
              />
              <Stat label="Priority" value={String(detail.priority)} />
              <div className="flex flex-col gap-0.5">
                <dt className="text-label uppercase tracking-wider text-gray-500">State</dt>
                <dd>
                  <StatusBadge
                    status={detail.isActive ? 'approved' : 'cancelled'}
                    label={detail.isActive ? 'Active' : 'Inactive'}
                  />
                </dd>
              </div>
            </dl>

            {detail.conditionsJson && detail.conditionsJson.brackets.length > 0 ? (
              <div className="mt-4 border-t border-gray-200 pt-4">
                <h3 className="text-label uppercase tracking-wider text-gray-500">Volume Brackets</h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  {detail.conditionsJson.brackets.map((b, i) => (
                    <span
                      key={i}
                      className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700"
                    >
                      <span className="font-mono tabular-nums">{b.minQty}+</span> →{' '}
                      <span className="font-mono tabular-nums">{b.discountPct}%</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          {/* Add override */}
          <section className="panel mb-6 p-4">
            <h2 className="text-label uppercase tracking-wider text-gray-500">Add Override</h2>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="ovProduct">Product ID</Label>
                <Input
                  id="ovProduct"
                  value={draft.shopifyProductId}
                  onChange={(e) => setDraft((d) => ({ ...d, shopifyProductId: e.target.value }))}
                  placeholder="gid://shopify/Product/…"
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="ovVariant">Variant ID (optional)</Label>
                <Input
                  id="ovVariant"
                  value={draft.shopifyVariantId}
                  onChange={(e) => setDraft((d) => ({ ...d, shopifyVariantId: e.target.value }))}
                  placeholder="gid://shopify/ProductVariant/…"
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ovPrice">Price</Label>
                <Input
                  id="ovPrice"
                  inputMode="decimal"
                  value={draft.price}
                  onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ovCompare">Compare At (optional)</Label>
                <Input
                  id="ovCompare"
                  inputMode="decimal"
                  value={draft.compareAtPrice}
                  onChange={(e) => setDraft((d) => ({ ...d, compareAtPrice: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
              <div className="flex items-end sm:col-span-2">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={bulk.isPending}
                  onClick={addOverride}
                >
                  {bulk.isPending ? <Spinner /> : <Plus className="h-4 w-4" />}
                  Add override
                </Button>
              </div>
            </div>
            {draftError ? <p className="mt-2 text-xs text-red-700">{draftError}</p> : null}
          </section>

          {/* Override table */}
          <section className="panel">
            <div className="border-b border-gray-200 px-4 py-3">
              <h2 className="text-label uppercase tracking-wider text-gray-500">Price Overrides</h2>
            </div>
            {overridesQuery.isLoading ? (
              <LoadingSkeleton rows={6} columns={[3, 2, 1, 1, 1]} />
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Variant</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Compare At</TableHead>
                      <TableHead>Currency</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overrides.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-8 text-center text-sm text-gray-500">
                          No price overrides yet. Add one above or import a CSV.
                        </TableCell>
                      </TableRow>
                    ) : (
                      overrides.map((ov) => (
                        <TableRow key={ov.id}>
                          <TableCell className="max-w-[220px] truncate font-mono text-xs">
                            {ov.shopifyProductId}
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate font-mono text-xs text-gray-500">
                            {ov.shopifyVariantId ?? '— all variants —'}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {formatMoney(ov.price)}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums text-gray-500">
                            {ov.compareAtPrice ? formatMoney(ov.compareAtPrice) : '—'}
                          </TableCell>
                          <TableCell className="text-gray-600">{ov.currency}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => setDeleteTarget(ov)}
                            >
                              Delete
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
                <CursorPagination
                  hasPrevious={pageIndex > 0}
                  hasNext={pageIndex < pages.length - 1 || overridesQuery.hasNextPage}
                  isLoading={overridesQuery.isFetchingNextPage}
                  onPrevious={() => setPageIndex((i) => Math.max(0, i - 1))}
                  onNext={goNext}
                  caption={`${overrides.length} on this page`}
                />
              </>
            )}
          </section>
        </>
      )}

      <OverrideImportModal open={importOpen} onOpenChange={setImportOpen} tierId={tierId} />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete this override?"
        description={
          deleteTarget ? (
            <span>
              The override for <span className="font-mono">{deleteTarget.shopifyProductId}</span> will
              be removed and buyers on this tier will fall back to standard pricing.
            </span>
          ) : null
        }
        confirmLabel="Delete"
        destructive
        isLoading={del.isPending}
        onConfirm={confirmDelete}
      />
    </PageContainer>
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
