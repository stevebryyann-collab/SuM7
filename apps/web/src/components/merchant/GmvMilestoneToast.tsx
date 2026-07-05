'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import { PartyPopper } from 'lucide-react';
import { useMerchantDashboard } from '@/hooks/useMerchantDashboard';

/**
 * GMV milestone celebrations. When the merchant's lifetime paid GMV crosses a
 * threshold, a strategic toast fires once — reinforcing the platform's core
 * competitive story (zero marketplace commission vs. Faire's ~15%). Each
 * milestone shows at most once per merchant, tracked in localStorage. A merchant
 * who is already past several thresholds on first load sees only their highest
 * new milestone; the lower ones are silently marked shown so they never spam.
 *
 * Renders nothing — a pure side-effect component mounted on the dashboard. Reads
 * `allTimeGmv` from the GraphQL dashboard query; if that query is unavailable the
 * effect simply no-ops (no milestone fires), never breaking the page.
 */

interface Milestone {
  key: string;
  threshold: number;
  message: string;
}

const MILESTONES: readonly Milestone[] = [
  { key: '1k', threshold: 1_000, message: '🎉 First $1,000 in wholesale revenue. You’re live.' },
  {
    key: '10k',
    threshold: 10_000,
    message:
      'You’ve processed $10,000 in wholesale orders. At Faire’s typical rate, that would have cost you ~$1,500 in commission. You kept 100%.',
  },
  {
    key: '50k',
    threshold: 50_000,
    message: 'Halfway to $100K. You’ve saved ~$7,500 in marketplace commission.',
  },
  {
    key: '100k',
    threshold: 100_000,
    message: 'Six figures. $100,000 in wholesale revenue. ~$15,000 you didn’t pay to a marketplace.',
  },
  {
    key: '500k',
    threshold: 500_000,
    message: 'You’ve processed $500K through your own channel. That’s ~$75,000 in commission you kept.',
  },
] as const;

export function GmvMilestoneToast(): null {
  const { data: session } = useSession();
  const { data } = useMerchantDashboard();

  const merchantId = session?.merchantId;
  const allTimeGmv = data?.allTimeGmv;

  useEffect(() => {
    if (!merchantId || allTimeGmv == null) return;
    const gmv = Number(allTimeGmv);
    if (!Number.isFinite(gmv)) return;

    const storageKey = (key: string): string => `milestone_shown_${merchantId}_${key}`;
    const reached = MILESTONES.filter((m) => gmv >= m.threshold);
    if (reached.length === 0) return;

    // Celebrate only the single highest milestone we have not shown yet; mark all
    // reached milestones as shown so lower ones never fire retroactively.
    let toCelebrate: Milestone | null = null;
    for (const m of reached) {
      if (localStorage.getItem(storageKey(m.key)) !== '1') toCelebrate = m;
    }
    if (!toCelebrate) return;

    for (const m of reached) localStorage.setItem(storageKey(m.key), '1');
    toast.success(toCelebrate.message, {
      duration: 10_000,
      icon: <PartyPopper size={16} className="text-success" />,
    });
  }, [merchantId, allTimeGmv]);

  return null;
}
