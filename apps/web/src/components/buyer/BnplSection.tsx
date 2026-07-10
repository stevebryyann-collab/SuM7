'use client';

import { useEffect } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { formatMoney } from '@/lib/format';
import { useBnplEligibility } from '@/hooks/useBnpl';
import { cn } from '@/lib/cn';

/**
 * Fee/label mapping for Resolve term lengths (days). The eligibility endpoint
 * returns the offered term days; this is the single place to extend copy/fees as
 * the provider adds terms (e.g. installment plans surface as their own term value).
 */
const RESOLVE_TERM_META: Record<number, { label: string; fee: string }> = {
  60: { label: 'Net 60 via Resolve', fee: '0% fee' },
  90: { label: 'Net 90 via Resolve', fee: '1.5% fee' },
};

function resolveTermMeta(days: number): { label: string; fee: string } {
  return RESOLVE_TERM_META[days] ?? { label: `Net ${days} via Resolve`, fee: 'fee applies' };
}

interface BnplSectionProps {
  /** Order subtotal estimate used for the eligibility check. */
  subtotal: number;
  /** Selected term in days; 0 = standard Net 30 (no financing). */
  selectedTermDays: number;
  onSelectTermDays: (days: number) => void;
  /** Disabled while an order is being placed. */
  disabled?: boolean;
}

/**
 * "Pay later with Resolve" section of the Review-Order modal (rendered only when
 * the merchant's plan enables BNPL). Checks eligibility for the subtotal, then
 * offers the standard Net 30 term plus any Resolve financing terms. The selected
 * term is lifted to the modal, which swaps its primary action to "Place Order &
 * Pay with Resolve" when a financing term is chosen.
 */
export function BnplSection({
  subtotal,
  selectedTermDays,
  onSelectTermDays,
  disabled,
}: BnplSectionProps): JSX.Element {
  const eligibility = useBnplEligibility();
  const result = eligibility.data;

  // If the buyer is not eligible, force the selection back to the standard term.
  useEffect(() => {
    if (result && !result.eligible && selectedTermDays !== 0) onSelectTermDays(0);
  }, [result, selectedTermDays, onSelectTermDays]);

  return (
    <div className="rounded-md border border-glass-border bg-white/40 p-3">
      <p className="text-sm font-medium text-text-primary">Pay later with Resolve</p>
      <p className="mt-0.5 text-xs text-text-secondary">
        Split this order into monthly payments. Check your eligibility instantly.
      </p>

      {result === undefined ? (
        <div className="mt-3">
          <Button
            variant="default"
            size="sm"
            disabled={disabled || eligibility.isPending}
            onClick={() => eligibility.mutate({ orderAmount: subtotal })}
          >
            {eligibility.isPending ? <Spinner className="h-3.5 w-3.5" /> : null}
            {eligibility.isPending ? 'Checking…' : 'Check eligibility'}
          </Button>
          {eligibility.isError ? (
            <p className="mt-2 text-xs text-red-600">
              Financing options are temporarily unavailable. Please try again.
            </p>
          ) : null}
        </div>
      ) : result.eligible ? (
        <div className="mt-3 space-y-3">
          <div className="inline-flex items-center gap-1.5 rounded bg-green-100 px-2 py-1 text-xs font-medium text-green-800">
            <CheckCircle2 className="h-3.5 w-3.5" />
            You’re eligible{result.approvedAmount ? ` for up to ${formatMoney(result.approvedAmount)}` : ''}
          </div>
          <fieldset className="space-y-2" disabled={disabled}>
            <legend className="sr-only">Choose a payment term</legend>
            <TermRadio
              checked={selectedTermDays === 0}
              onChange={() => onSelectTermDays(0)}
              label="Net 30"
              hint="standard, no fee"
            />
            {[...result.availableTermsDays]
              .sort((a, b) => a - b)
              .map((days) => {
                const meta = resolveTermMeta(days);
                return (
                  <TermRadio
                    key={days}
                    checked={selectedTermDays === days}
                    onChange={() => onSelectTermDays(days)}
                    label={meta.label}
                    hint={meta.fee}
                  />
                );
              })}
          </fieldset>
        </div>
      ) : (
        <div className="mt-3 rounded-md border border-glass-border bg-white/60 px-3 py-2 text-xs text-text-secondary">
          BNPL financing is not available for this order. Your order will proceed with standard Net 30 terms.
        </div>
      )}
    </div>
  );
}

function TermRadio({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  hint: string;
}): JSX.Element {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm',
        checked ? 'border-accent bg-white/60' : 'border-border bg-white/60 hover:bg-white/40',
      )}
    >
      <input
        type="radio"
        name="bnpl-term"
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 accent-accent"
      />
      <span className="text-text-primary">{label}</span>
      <span className="text-text-secondary">— {hint}</span>
    </label>
  );
}
