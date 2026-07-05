'use client';

import { useEffect, useState } from 'react';
import { ShoppingBag, X } from 'lucide-react';
import { formatPaymentTerms } from '@/lib/format';
import type { BuyerMe } from '@/types/api';

interface FirstUseWelcomeProps {
  /** The approved buyer's snapshot — supplies company, tier, and terms. */
  buyerMe: BuyerMe;
}

/**
 * One-time welcome banner shown after an approved buyer first lands on the
 * catalog. A dismissable info banner (never a modal), keyed in localStorage so it
 * never reappears once dismissed.
 *
 * Deviation from the spec's `b2b_welcomed_{buyerId}`: the client is never given
 * the numeric buyer id (buyer identity is Clerk-owned; `/buyer/me` returns no id).
 * We key on the company name instead — unique per buyer within a merchant portal,
 * and stable across sessions — so the one-time guarantee still holds.
 */
export function FirstUseWelcome({ buyerMe }: FirstUseWelcomeProps): JSX.Element | null {
  const storageKey = `b2b_welcomed_${buyerMe.companyName}`;
  // Start hidden; reveal only after we confirm localStorage has no prior dismissal
  // (avoids an SSR/first-paint flash of an already-dismissed banner).
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(storageKey) !== '1') setVisible(true);
  }, [storageKey]);

  const dismiss = (): void => {
    localStorage.setItem(storageKey, '1');
    setVisible(false);
  };

  if (!visible) return null;

  const tierName = buyerMe.pricingTierName ?? 'standard';
  const terms = formatPaymentTerms(buyerMe.paymentTerms);

  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border border-accent-border bg-accent-subtle p-4">
      <ShoppingBag className="mt-0.5 h-6 w-6 flex-shrink-0 text-accent" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-base font-semibold text-text-primary">Welcome, {buyerMe.companyName}!</p>
        <p className="mt-0.5 text-sm text-text-secondary">
          You&apos;re set up with <span className="font-medium text-text-primary">{tierName}</span> pricing and{' '}
          <span className="font-medium text-text-primary">{terms}</span> payment terms. Search for products below,
          set quantities, and place your first order.
        </p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss welcome message"
        className="flex-shrink-0 rounded-md p-1 text-text-tertiary transition-colors duration-fast hover:bg-surface hover:text-text-primary"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
