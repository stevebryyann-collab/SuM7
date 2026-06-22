'use client';

import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  ApproveBuyerSchema,
  RejectBuyerSchema,
  UpdateBuyerSchema,
  type ApproveBuyerInput,
  type RejectBuyerInput,
  type UpdateBuyerInput,
} from '@b2b/shared/schemas';
import type { PaymentTerms } from '@b2b/shared/types';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { PiiField } from './PiiField';
import { ApiClientError } from '@/lib/api/error';
import { formatDate, formatMoney, formatRelative } from '@/lib/format';
import {
  useApproveBuyer,
  useBuyerDetail,
  useRejectBuyer,
  useRevealApplicationPii,
  useUpdateBuyer,
} from '@/hooks/useBuyers';
import { usePricingTiers } from '@/hooks/usePricingTiers';
import type { ApplicationPii, BuyerApplication } from '@/types/api';

const PAYMENT_TERMS: PaymentTerms[] = ['immediate', 'net15', 'net30', 'net60', 'net90'];
const PAYMENT_TERMS_LABELS: Record<PaymentTerms, string> = {
  immediate: 'Immediate',
  net15: 'Net 15',
  net30: 'Net 30',
  net60: 'Net 60',
  net90: 'Net 90',
};
const REJECTION_MAX = 2000;
const NOTES_MAX = 2000;
const DEFAULT_TIER = '__default__';
/** Revealed PII auto-masks after this long, bounding on-screen exposure. */
const PII_REVEAL_MS = 30_000;

/**
 * What the panel is operating on:
 *   - `application` — a pending registration application (approve / reject / reveal PII)
 *   - `buyer`       — an existing buyer record (read-only view + approved inline edit)
 */
export type BuyerPanelTarget =
  | { kind: 'application'; application: BuyerApplication }
  | { kind: 'buyer'; buyerId: string; companyName: string };

export interface BuyerApprovalPanelProps {
  target: BuyerPanelTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Right-side slide-over for the buyers admin. Two distinct modes share one
 * panel:
 *
 *   Application mode — Application Details (PII masked, revealed only via the
 *   audited endpoint behind a confirm dialog) + Decision (Approve / Reject).
 *   Approve sets pricing tier, payment terms, optional credit limit and notes;
 *   Reject requires a reason and confirms before committing.
 *
 *   Buyer mode — full per-buyer detail. Approved buyers expose an inline edit
 *   form (tier / terms / credit / notes); other statuses are read-only.
 *
 * Both forms validate with the SAME Zod schemas the API enforces.
 */
export function BuyerApprovalPanel({
  target,
  open,
  onOpenChange,
}: BuyerApprovalPanelProps): JSX.Element {
  const headerTitle =
    target?.kind === 'application'
      ? target.application.companyName
      : target?.kind === 'buyer'
        ? target.companyName
        : 'Buyer';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        {target?.kind === 'application' ? (
          <ApplicationPanel
            application={target.application}
            open={open}
            title={headerTitle}
            onOpenChange={onOpenChange}
          />
        ) : target?.kind === 'buyer' ? (
          <BuyerPanel buyerId={target.buyerId} title={headerTitle} onOpenChange={onOpenChange} />
        ) : (
          <>
            <SheetHeader>
              <SheetTitle>{headerTitle}</SheetTitle>
            </SheetHeader>
            <div className="flex-1" />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Application mode ────────────────────────────────────────────────────────

function ApplicationPanel({
  application,
  open,
  title,
  onOpenChange,
}: {
  application: BuyerApplication;
  open: boolean;
  title: string;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const { data: tiers } = usePricingTiers();
  const approve = useApproveBuyer();
  const reject = useRejectBuyer();
  const reveal = useRevealApplicationPii();
  const [confirmReject, setConfirmReject] = useState(false);
  const [confirmReveal, setConfirmReveal] = useState(false);
  const [revealed, setRevealed] = useState<ApplicationPii | null>(null);

  const approveForm = useForm<ApproveBuyerInput>({
    resolver: zodResolver(ApproveBuyerSchema),
    defaultValues: {
      applicationId: application.id,
      paymentTerms: 'immediate',
      pricingTierId: null,
      creditLimit: null,
      notes: '',
    },
  });

  const rejectForm = useForm<RejectBuyerInput>({
    resolver: zodResolver(RejectBuyerSchema),
    defaultValues: { applicationId: application.id, rejectionReason: '' },
  });

  // Reset both forms and clear any revealed PII whenever the selected
  // application changes (panel reused across rows).
  useEffect(() => {
    approveForm.reset({
      applicationId: application.id,
      paymentTerms: 'immediate',
      pricingTierId: null,
      creditLimit: null,
      notes: '',
    });
    rejectForm.reset({ applicationId: application.id, rejectionReason: '' });
    setRevealed(null);
    setConfirmReveal(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [application.id]);

  // Never keep plaintext PII in memory once the panel is closed.
  useEffect(() => {
    if (!open) setRevealed(null);
  }, [open]);

  // Plaintext PII auto-masks 30s after a reveal — bounds on-screen exposure and
  // matches the audited-reveal model (re-revealing writes a fresh audit row).
  // setRevealed mints a new object per reveal, so this re-arms on each reveal.
  useEffect(() => {
    if (!revealed) return;
    const timer = setTimeout(() => setRevealed(null), PII_REVEAL_MS);
    return () => clearTimeout(timer);
  }, [revealed]);

  const onApprove = approveForm.handleSubmit((values) => {
    approve.mutate(values, {
      onSuccess: () => {
        toast.success(`${application.companyName} approved`);
        onOpenChange(false);
      },
      onError: (error) =>
        toast.error(error instanceof ApiClientError ? error.message : 'Approval failed'),
    });
  });

  const submitReject = (): void => {
    void rejectForm.handleSubmit((values) => {
      reject.mutate(values, {
        onSuccess: () => {
          toast.success('Application rejected');
          setConfirmReject(false);
          onOpenChange(false);
        },
        onError: (error) => {
          setConfirmReject(false);
          toast.error(error instanceof ApiClientError ? error.message : 'Rejection failed');
        },
      });
    })();
  };

  const runReveal = (): void => {
    reveal.mutate(application.id, {
      onSuccess: (pii) => {
        setRevealed(pii);
        setConfirmReveal(false);
      },
      onError: (error) => {
        setConfirmReveal(false);
        toast.error(error instanceof ApiClientError ? error.message : 'Could not reveal');
      },
    });
  };

  const rejectionReason = rejectForm.watch('rejectionReason') ?? '';
  const approveNotes = approveForm.watch('notes') ?? '';
  const isRevealed = revealed !== null;

  return (
    <>
      <SheetHeader>
        <SheetTitle>{title}</SheetTitle>
        <SheetDescription>Submitted {formatDate(application.createdAt)}</SheetDescription>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <Tabs defaultValue="details">
          <TabsList>
            <TabsTrigger value="details">Application Details</TabsTrigger>
            <TabsTrigger value="decision">Decision</TabsTrigger>
          </TabsList>

          <TabsContent value="details">
            <dl className="grid grid-cols-2 gap-4">
              <Detail label="Company" value={application.companyName} />
              <Detail label="Email" value={application.email} />
              <Detail label="Business Type" value={application.businessType ?? '—'} />
              <Detail label="Website" value={application.website ?? '—'} />
              <PiiField
                label="Tax ID"
                hasValue={application.hasTaxId}
                value={revealed?.taxId ?? null}
                revealed={isRevealed}
                isRevealing={reveal.isPending}
                onReveal={() => setConfirmReveal(true)}
              />
              <PiiField
                label="Phone"
                hasValue={application.hasPhone}
                value={revealed?.phone ?? null}
                revealed={isRevealed}
                isRevealing={reveal.isPending}
                onReveal={() => setConfirmReveal(true)}
              />
              <Detail label="Est. Monthly Order" value={application.estimatedMonthlyOrder ?? '—'} />
              <Detail label="Status" value={application.status} />
            </dl>
            {isRevealed ? (
              <p className="mt-3 text-xs text-gray-400">
                Sensitive fields auto-hide 30 seconds after reveal.
              </p>
            ) : null}
            {application.message ? (
              <div className="mt-4">
                <span className="text-label uppercase tracking-wider text-gray-500">Message</span>
                <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{application.message}</p>
              </div>
            ) : null}
          </TabsContent>

          <TabsContent value="decision">
            <Tabs defaultValue="approve">
              <TabsList>
                <TabsTrigger value="approve">Approve</TabsTrigger>
                <TabsTrigger value="reject">Reject</TabsTrigger>
              </TabsList>

              {/* ── Approve ─────────────────────────────────────────── */}
              <TabsContent value="approve">
                <form onSubmit={onApprove} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="pricingTier">Pricing Tier</Label>
                    <Controller
                      control={approveForm.control}
                      name="pricingTierId"
                      render={({ field }) => (
                        <Select
                          value={field.value ?? DEFAULT_TIER}
                          onValueChange={(v) => field.onChange(v === DEFAULT_TIER ? null : v)}
                        >
                          <SelectTrigger id="pricingTier">
                            <SelectValue placeholder="Default tier" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={DEFAULT_TIER}>Default tier</SelectItem>
                            {(tiers ?? []).map((tier) => (
                              <SelectItem key={tier.id} value={tier.id}>
                                {tier.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="paymentTerms">Payment Terms</Label>
                    <Controller
                      control={approveForm.control}
                      name="paymentTerms"
                      render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger id="paymentTerms">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PAYMENT_TERMS.map((term) => (
                              <SelectItem key={term} value={term}>
                                {PAYMENT_TERMS_LABELS[term]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="creditLimit">Credit Limit (optional)</Label>
                    <Controller
                      control={approveForm.control}
                      name="creditLimit"
                      render={({ field }) => (
                        <Input
                          id="creditLimit"
                          inputMode="decimal"
                          placeholder="0.00"
                          value={field.value ?? ''}
                          onChange={(e) => field.onChange(e.target.value === '' ? null : e.target.value)}
                        />
                      )}
                    />
                    {approveForm.formState.errors.creditLimit ? (
                      <p className="text-xs text-red-700">
                        {approveForm.formState.errors.creditLimit.message}
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="approveNotes">Internal Notes (optional)</Label>
                    <Textarea
                      id="approveNotes"
                      rows={3}
                      maxLength={NOTES_MAX}
                      placeholder="Context for your team — never shown to the buyer."
                      {...approveForm.register('notes')}
                    />
                    <div className="flex justify-end">
                      <span className="text-xs text-gray-400 tabular-nums">
                        {approveNotes.length}/{NOTES_MAX}
                      </span>
                    </div>
                  </div>

                  <Button type="submit" variant="primary" className="w-full" disabled={approve.isPending}>
                    {approve.isPending ? <Spinner /> : null}
                    Approve buyer
                  </Button>
                </form>
              </TabsContent>

              {/* ── Reject ──────────────────────────────────────────── */}
              <TabsContent value="reject">
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="rejectionReason">Reason</Label>
                    <Textarea
                      id="rejectionReason"
                      rows={5}
                      maxLength={REJECTION_MAX}
                      placeholder="Explain why this application is being rejected…"
                      {...rejectForm.register('rejectionReason')}
                    />
                    <div className="flex items-center justify-between">
                      {rejectForm.formState.errors.rejectionReason ? (
                        <p className="text-xs text-red-700">
                          {rejectForm.formState.errors.rejectionReason.message}
                        </p>
                      ) : (
                        <span />
                      )}
                      <span className="text-xs text-gray-400 tabular-nums">
                        {rejectionReason.length}/{REJECTION_MAX}
                      </span>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="destructive"
                    className="w-full"
                    disabled={reject.isPending || rejectionReason.trim().length === 0}
                    onClick={() => setConfirmReject(true)}
                  >
                    Reject application
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </TabsContent>
        </Tabs>
      </div>

      <SheetFooter>
        <Button variant="default" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      </SheetFooter>

      <ConfirmDialog
        open={confirmReject}
        onOpenChange={setConfirmReject}
        title="Reject this application?"
        description="The buyer will be notified and cannot access this merchant's portal. This is recorded in the application history."
        confirmLabel="Reject"
        destructive
        isLoading={reject.isPending}
        onConfirm={submitReject}
      />

      <ConfirmDialog
        open={confirmReveal}
        onOpenChange={(next) => !reveal.isPending && setConfirmReveal(next)}
        title="Reveal sensitive information?"
        description="Tax ID and phone are personal data. Revealing them is recorded in the audit log against your account."
        confirmLabel="Reveal"
        isLoading={reveal.isPending}
        onConfirm={runReveal}
      />
    </>
  );
}

// ── Buyer mode ──────────────────────────────────────────────────────────────

function BuyerPanel({
  buyerId,
  title,
  onOpenChange,
}: {
  buyerId: string;
  title: string;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const { data: tiers } = usePricingTiers();
  const detailQuery = useBuyerDetail(buyerId);
  const update = useUpdateBuyer();
  const detail = detailQuery.data;

  const form = useForm<UpdateBuyerInput>({
    resolver: zodResolver(UpdateBuyerSchema),
    defaultValues: { pricingTierId: null, paymentTerms: 'immediate', creditLimit: null, notes: '' },
  });

  // Seed the edit form once the detail loads (or when switching buyers).
  useEffect(() => {
    if (!detail) return;
    form.reset({
      pricingTierId: detail.pricingTierId,
      paymentTerms: detail.paymentTerms,
      creditLimit: detail.creditLimit,
      notes: detail.notes ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.buyerId]);

  const onSave = form.handleSubmit((values) => {
    update.mutate(
      { buyerId, input: values },
      {
        onSuccess: () => toast.success('Buyer updated'),
        onError: (error) =>
          toast.error(error instanceof ApiClientError ? error.message : 'Update failed'),
      },
    );
  });

  const isApproved = detail?.approvalStatus === 'approved';

  return (
    <>
      <SheetHeader>
        <SheetTitle>{title}</SheetTitle>
        <SheetDescription>
          {detail ? detail.email : 'Loading buyer…'}
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {detailQuery.isLoading || !detail ? (
          <LoadingSkeleton rows={6} columns={[2, 3]} />
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-4">
              <Detail label="Company" value={detail.companyName} />
              <div className="flex flex-col gap-1">
                <span className="text-label uppercase tracking-wider text-gray-500">Status</span>
                <span>
                  <StatusBadge status={detail.approvalStatus} />
                </span>
              </div>
              <Detail label="Business Type" value={detail.businessType ?? '—'} />
              <Detail label="Member Since" value={formatDate(detail.createdAt)} />
              <Detail label="Orders" value={String(detail.orderCount)} />
              <Detail label="Outstanding" value={formatMoney(detail.outstandingInvoiceTotal)} />
              <Detail label="Last Order" value={formatRelative(detail.lastOrderAt)} />
              <Detail
                label="Approved"
                value={detail.approvedAt ? formatDate(detail.approvedAt) : '—'}
              />
            </dl>

            {isApproved ? (
              <form onSubmit={onSave} className="mt-6 space-y-4 border-t border-gray-200 pt-4">
                <h3 className="text-label uppercase tracking-wider text-gray-500">Edit Relationship</h3>

                <div className="space-y-1.5">
                  <Label htmlFor="editTier">Pricing Tier</Label>
                  <Controller
                    control={form.control}
                    name="pricingTierId"
                    render={({ field }) => (
                      <Select
                        value={field.value ?? DEFAULT_TIER}
                        onValueChange={(v) => field.onChange(v === DEFAULT_TIER ? null : v)}
                      >
                        <SelectTrigger id="editTier">
                          <SelectValue placeholder="Default tier" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={DEFAULT_TIER}>Default tier</SelectItem>
                          {(tiers ?? []).map((tier) => (
                            <SelectItem key={tier.id} value={tier.id}>
                              {tier.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="editTerms">Payment Terms</Label>
                  <Controller
                    control={form.control}
                    name="paymentTerms"
                    render={({ field }) => (
                      <Select value={field.value ?? 'immediate'} onValueChange={field.onChange}>
                        <SelectTrigger id="editTerms">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PAYMENT_TERMS.map((term) => (
                            <SelectItem key={term} value={term}>
                              {PAYMENT_TERMS_LABELS[term]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="editCredit">Credit Limit</Label>
                  <Controller
                    control={form.control}
                    name="creditLimit"
                    render={({ field }) => (
                      <Input
                        id="editCredit"
                        inputMode="decimal"
                        placeholder="No limit"
                        value={field.value ?? ''}
                        onChange={(e) => field.onChange(e.target.value === '' ? null : e.target.value)}
                      />
                    )}
                  />
                  {form.formState.errors.creditLimit ? (
                    <p className="text-xs text-red-700">{form.formState.errors.creditLimit.message}</p>
                  ) : null}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="editNotes">Internal Notes</Label>
                  <Textarea
                    id="editNotes"
                    rows={3}
                    maxLength={NOTES_MAX}
                    placeholder="Context for your team — never shown to the buyer."
                    value={form.watch('notes') ?? ''}
                    onChange={(e) => form.setValue('notes', e.target.value)}
                  />
                </div>

                <Button type="submit" variant="primary" className="w-full" disabled={update.isPending}>
                  {update.isPending ? <Spinner /> : null}
                  Save changes
                </Button>
              </form>
            ) : (
              <div className="mt-6 space-y-4 border-t border-gray-200 pt-4">
                <Detail label="Pricing Tier" value={detail.pricingTierName ?? 'Default'} />
                <Detail label="Payment Terms" value={PAYMENT_TERMS_LABELS[detail.paymentTerms]} />
                <Detail
                  label="Credit Limit"
                  value={detail.creditLimit ? formatMoney(detail.creditLimit) : 'No limit'}
                />
                {detail.notes ? <Detail label="Internal Notes" value={detail.notes} /> : null}
                <p className="text-xs text-gray-500">
                  Relationship settings are editable only for approved buyers.
                </p>
              </div>
            )}
          </>
        )}
      </div>

      <SheetFooter>
        <Button variant="default" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      </SheetFooter>
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-label uppercase tracking-wider text-gray-500">{label}</span>
      <span className="break-words text-sm text-gray-900">{value}</span>
    </div>
  );
}
