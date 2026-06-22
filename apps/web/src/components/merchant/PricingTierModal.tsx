'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import {
  CreatePricingTierSchema,
  UpdatePricingTierSchema,
  type CreatePricingTierInput,
  type UpdatePricingTierInput,
} from '@b2b/shared/schemas';
import type { PricingTierType } from '@b2b/shared/types';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { ApiClientError } from '@/lib/api/error';
import { useCreatePricingTier, useUpdatePricingTier } from '@/hooks/usePricingTiers';
import type { PricingTierDetail, PricingTierSummary } from '@/types/api';

const TIER_TYPES: { value: PricingTierType; label: string; hint: string }[] = [
  { value: 'percentage_off', label: 'Percentage Off', hint: 'A flat % discount off catalog prices.' },
  { value: 'fixed_price_list', label: 'Fixed Price List', hint: 'Per-variant override prices (set up after creating).' },
  { value: 'volume_breaks', label: 'Volume Breaks', hint: 'Quantity thresholds that unlock larger discounts.' },
];

interface BracketDraft {
  minQty: string;
  discountPct: string;
}

interface FormState {
  name: string;
  type: PricingTierType;
  baseDiscountPct: string;
  minOrderAmount: string;
  priority: string;
  isDefault: boolean;
  isActive: boolean;
  brackets: BracketDraft[];
}

function emptyForm(): FormState {
  return {
    name: '',
    type: 'percentage_off',
    baseDiscountPct: '',
    minOrderAmount: '',
    priority: '0',
    isDefault: false,
    isActive: true,
    brackets: [{ minQty: '', discountPct: '' }],
  };
}

function formFromTier(tier: PricingTierSummary, detail?: PricingTierDetail): FormState {
  const brackets = detail?.conditionsJson?.brackets ?? [];
  return {
    name: tier.name,
    type: (tier.type as PricingTierType) ?? 'percentage_off',
    baseDiscountPct: tier.baseDiscountPct ?? '',
    minOrderAmount: tier.minOrderAmount ?? '',
    priority: String(tier.priority),
    isDefault: tier.isDefault,
    isActive: tier.isActive,
    brackets:
      brackets.length > 0
        ? brackets.map((b) => ({ minQty: String(b.minQty), discountPct: String(b.discountPct) }))
        : [{ minQty: '', discountPct: '' }],
  };
}

export interface PricingTierModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the modal edits this tier; otherwise it creates a new one. */
  tier?: PricingTierSummary | null;
  /** Detail (carries conditionsJson) for an edit; optional for create. */
  detail?: PricingTierDetail | null;
}

/**
 * Create / edit a pricing tier. The tier `type` is chosen on create and fixed
 * thereafter (the update schema has no type field — changing pricing model would
 * orphan overrides/conditions). Volume-break tiers get a bracket builder whose
 * rules (≥1 bracket, strictly ascending minQty) mirror the shared
 * CreatePricingTierSchema superRefine, which we re-run on submit so client and
 * server agree exactly.
 */
export function PricingTierModal({
  open,
  onOpenChange,
  tier,
  detail,
}: PricingTierModalProps): JSX.Element {
  const isEdit = Boolean(tier);
  const create = useCreatePricingTier();
  const update = useUpdatePricingTier();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reset the form whenever the modal opens or the target tier changes.
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm(tier ? formFromTier(tier, detail ?? undefined) : emptyForm());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tier?.id, detail?.id]);

  const isPending = create.isPending || update.isPending;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const setBracket = (index: number, key: keyof BracketDraft, value: string): void => {
    setForm((prev) => ({
      ...prev,
      brackets: prev.brackets.map((b, i) => (i === index ? { ...b, [key]: value } : b)),
    }));
  };

  const addBracket = (): void => {
    setForm((prev) => ({ ...prev, brackets: [...prev.brackets, { minQty: '', discountPct: '' }] }));
  };

  const removeBracket = (index: number): void => {
    setForm((prev) => ({
      ...prev,
      brackets: prev.brackets.length > 1 ? prev.brackets.filter((_, i) => i !== index) : prev.brackets,
    }));
  };

  const buildConditions = (): { brackets: { minQty: number; discountPct: number }[] } | undefined => {
    if (form.type !== 'volume_breaks') return undefined;
    return {
      brackets: form.brackets.map((b) => ({
        minQty: Number(b.minQty),
        discountPct: Number(b.discountPct),
      })),
    };
  };

  const onSubmit = (): void => {
    setErrors({});
    const conditionsJson = buildConditions();

    if (isEdit && tier) {
      const payload: UpdatePricingTierInput = {
        name: form.name.trim(),
        baseDiscountPct:
          form.type === 'percentage_off' && form.baseDiscountPct !== ''
            ? Number(form.baseDiscountPct)
            : null,
        isDefault: form.isDefault,
        minOrderAmount: form.minOrderAmount.trim() === '' ? null : form.minOrderAmount.trim(),
        priority: Number(form.priority),
        isActive: form.isActive,
        ...(form.type === 'volume_breaks' ? { conditionsJson } : {}),
      };
      const parsed = UpdatePricingTierSchema.safeParse(payload);
      if (!parsed.success) {
        setErrors(flatten(parsed.error));
        return;
      }
      update.mutate(
        { id: tier.id, input: parsed.data },
        {
          onSuccess: () => {
            toast.success('Tier updated');
            onOpenChange(false);
          },
          onError: (error) =>
            toast.error(error instanceof ApiClientError ? error.message : 'Update failed'),
        },
      );
      return;
    }

    const payload: CreatePricingTierInput = {
      name: form.name.trim(),
      type: form.type,
      ...(form.type === 'percentage_off' && form.baseDiscountPct !== ''
        ? { baseDiscountPct: Number(form.baseDiscountPct) }
        : {}),
      isDefault: form.isDefault,
      ...(form.minOrderAmount.trim() !== '' ? { minOrderAmount: form.minOrderAmount.trim() } : {}),
      priority: Number(form.priority),
      isActive: form.isActive,
      ...(conditionsJson ? { conditionsJson } : {}),
    };
    const parsed = CreatePricingTierSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(flatten(parsed.error));
      return;
    }
    create.mutate(parsed.data, {
      onSuccess: () => {
        toast.success('Tier created');
        onOpenChange(false);
      },
      onError: (error) =>
        toast.error(error instanceof ApiClientError ? error.message : 'Create failed'),
    });
  };

  const typeHint = TIER_TYPES.find((t) => t.value === form.type)?.hint;

  return (
    <Dialog open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit pricing tier' : 'New pricing tier'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update this tier. Pricing model is fixed once created.'
              : 'Choose a pricing model and configure its terms.'}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tierName">Name</Label>
            <Input
              id="tierName"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Volume Partner"
            />
            {errors.name ? <p className="text-xs text-red-700">{errors.name}</p> : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tierType">Pricing Model</Label>
            <Select
              value={form.type}
              onValueChange={(v) => set('type', v as PricingTierType)}
              disabled={isEdit}
            >
              <SelectTrigger id="tierType">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIER_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {typeHint ? <p className="text-xs text-gray-500">{typeHint}</p> : null}
          </div>

          {form.type === 'percentage_off' ? (
            <div className="space-y-1.5">
              <Label htmlFor="baseDiscount">Base Discount %</Label>
              <Input
                id="baseDiscount"
                inputMode="decimal"
                value={form.baseDiscountPct}
                onChange={(e) => set('baseDiscountPct', e.target.value)}
                placeholder="20"
              />
              {errors.baseDiscountPct ? (
                <p className="text-xs text-red-700">{errors.baseDiscountPct}</p>
              ) : null}
            </div>
          ) : null}

          {form.type === 'volume_breaks' ? (
            <div className="space-y-2">
              <Label>Volume Brackets</Label>
              <p className="text-xs text-gray-500">
                Quantity thresholds must strictly ascend. Each unlocks its discount % at that quantity.
              </p>
              <div className="space-y-2">
                {form.brackets.map((bracket, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      inputMode="numeric"
                      value={bracket.minQty}
                      onChange={(e) => setBracket(index, 'minQty', e.target.value)}
                      placeholder="Min qty"
                      className="h-8"
                    />
                    <Input
                      inputMode="decimal"
                      value={bracket.discountPct}
                      onChange={(e) => setBracket(index, 'discountPct', e.target.value)}
                      placeholder="Discount %"
                      className="h-8"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      disabled={form.brackets.length <= 1}
                      onClick={() => removeBracket(index)}
                      aria-label="Remove bracket"
                    >
                      <Trash2 className="h-4 w-4 text-gray-500" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button type="button" variant="default" size="sm" onClick={addBracket}>
                <Plus className="h-4 w-4" />
                Add bracket
              </Button>
              {errors.conditionsJson ? (
                <p className="text-xs text-red-700">{errors.conditionsJson}</p>
              ) : null}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="minOrder">Minimum Order (optional)</Label>
              <Input
                id="minOrder"
                inputMode="decimal"
                value={form.minOrderAmount}
                onChange={(e) => set('minOrderAmount', e.target.value)}
                placeholder="0.00"
              />
              {errors.minOrderAmount ? (
                <p className="text-xs text-red-700">{errors.minOrderAmount}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="priority">Priority</Label>
              <Input
                id="priority"
                inputMode="numeric"
                value={form.priority}
                onChange={(e) => set('priority', e.target.value)}
                placeholder="0"
              />
              {errors.priority ? <p className="text-xs text-red-700">{errors.priority}</p> : null}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300 text-accent focus:ring-accent/40"
              checked={form.isDefault}
              onChange={(e) => set('isDefault', e.target.checked)}
            />
            Set as default tier for new buyers
          </label>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300 text-accent focus:ring-accent/40"
              checked={form.isActive}
              onChange={(e) => set('isActive', e.target.checked)}
            />
            Active
          </label>
        </DialogBody>

        <DialogFooter>
          <Button variant="default" disabled={isPending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={isPending} onClick={onSubmit}>
            {isPending ? <Spinner /> : null}
            {isEdit ? 'Save changes' : 'Create tier'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Flatten a ZodError into `{ fieldPath: firstMessage }` for inline display. */
function flatten(error: { issues: { path: (string | number)[]; message: string }[] }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0] !== undefined ? String(issue.path[0]) : 'form';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
