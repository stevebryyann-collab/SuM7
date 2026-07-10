'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { cn } from '@/lib/cn';

/**
 * Sub-navigation across the three settings surfaces. The Team tab is owner-only
 * (the route itself is owner-guarded server-side). Built as links — these are
 * full page navigations, not in-place tab panels — styled to match the Tabs
 * primitive (1px bottom border, accent active underline).
 */
const TABS: Array<{ href: string; label: string; ownerOnly?: boolean }> = [
  { href: '/settings', label: 'General' },
  { href: '/settings/billing', label: 'Billing' },
  { href: '/settings/team', label: 'Team', ownerOnly: true },
];

export function SettingsTabs(): JSX.Element {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isOwner = session?.role === 'owner';

  return (
    <div className="mb-6 inline-flex w-full items-center gap-1 border-b border-border">
      {TABS.filter((tab) => !tab.ownerOnly || isOwner).map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              'inline-flex items-center whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors duration-75',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              active
                ? 'border-accent text-text-primary'
                : 'border-transparent text-text-secondary hover:text-text-secondary',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
