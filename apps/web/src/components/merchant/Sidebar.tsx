'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  BarChart2,
  FileText,
  LayoutDashboard,
  Settings as SettingsIcon,
  ShoppingCart,
  Tag,
  UserCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { usePendingBuyersCount } from '@/hooks/useBuyers';

/**
 * Merchant admin sidebar — 220px, fixed left, full height. Page-background
 * surface with a single right border (no shadow on the container). The active
 * item gets the accent-subtle fill plus a 2px left accent line. The Buyers item
 * shows a pulsing warning badge while applications await review.
 */
interface NavItemDef {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Renders the pending-buyers notification badge. */
  badge?: 'pendingBuyers';
  /** When set, the item is only shown to these merchant roles. */
  roles?: string[];
}

const NAV_GROUPS: { label: string; items: NavItemDef[] }[] = [
  { label: 'Overview', items: [{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }] },
  {
    label: 'Wholesale',
    items: [
      { href: '/buyers', label: 'Buyers', icon: Users, badge: 'pendingBuyers' },
      { href: '/pricing', label: 'Pricing', icon: Tag },
      { href: '/orders', label: 'Orders', icon: ShoppingCart },
      { href: '/invoices', label: 'Invoices', icon: FileText },
      { href: '/rep', label: 'Sales Rep', icon: UserCheck, roles: ['sales_rep', 'admin', 'owner'] },
    ],
  },
  { label: 'Insights', items: [{ href: '/analytics', label: 'Analytics', icon: BarChart2 }] },
  { label: 'Settings', items: [{ href: '/settings', label: 'Settings', icon: SettingsIcon }] },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar(): JSX.Element {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { data: pendingCount } = usePendingBuyersCount();

  const storeName = session?.shopifyDomain ?? 'Wholesale Portal';
  const email = session?.shopifyDomain ?? 'Not signed in';
  const role = session?.role ?? null;
  const roleLine = role ? roleLabel(role) : 'Merchant';
  const initial = (storeName[0] ?? 'M').toUpperCase();

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.roles || (role !== null && item.roles.includes(role))),
  })).filter((group) => group.items.length > 0);

  return (
    <aside className="fixed inset-y-0 left-0 z-40 flex w-[220px] flex-col border-r border-border bg-bg">
      {/* Brand */}
      <div className="flex h-14 items-center border-b border-border px-4">
        <span className="truncate text-lg font-semibold text-text-primary" title={storeName}>
          {storeName}
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2">
        {visibleGroups.map((group) => (
          <div key={group.label}>
            <p className="select-none px-5 pb-1 pt-4 text-2xs font-medium uppercase tracking-wider text-text-tertiary">
              {group.label}
            </p>
            {group.items.map((item) => (
              <NavItem
                key={item.href}
                item={item}
                active={isActive(pathname, item.href)}
                pendingCount={item.badge === 'pendingBuyers' ? (pendingCount ?? 0) : 0}
              />
            ))}
          </div>
        ))}
      </nav>

      {/* User */}
      <div className="mt-auto flex items-center gap-2 border-t border-border p-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-sm font-medium text-accent">
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text-primary">{roleLine}</p>
          <p className="truncate text-xs text-text-secondary" title={email}>
            {email}
          </p>
        </div>
        <Link
          href="/settings"
          aria-label="Settings"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors duration-fast hover:bg-neutral-bg hover:text-text-primary"
        >
          <SettingsIcon className="h-4 w-4" />
        </Link>
      </div>
    </aside>
  );
}

function NavItem({
  item,
  active,
  pendingCount,
}: {
  item: NavItemDef;
  active: boolean;
  pendingCount: number;
}): JSX.Element {
  const Icon = item.icon;
  const showBadge = item.badge === 'pendingBuyers' && pendingCount > 0;

  return (
    <Link
      href={item.href}
      className={cn(
        'relative mx-2 flex items-center gap-2 rounded-md px-3 py-1.5 text-base font-medium transition-colors duration-fast',
        active
          ? 'bg-accent-subtle text-accent'
          : 'text-text-secondary hover:bg-neutral-bg hover:text-text-primary',
      )}
    >
      {active ? (
        <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-accent" aria-hidden />
      ) : null}
      <Icon className={cn('h-4 w-4', active ? 'text-accent' : 'text-text-tertiary')} />
      <span>{item.label}</span>
      {showBadge ? (
        <span className="relative ml-auto inline-flex">
          <span className="absolute inset-0 inline-flex animate-ping rounded-full bg-warning opacity-75" aria-hidden />
          <span className="relative flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-warning px-1 text-2xs font-semibold text-white">
            {pendingCount}
          </span>
        </span>
      ) : null}
    </Link>
  );
}

function roleLabel(role: string): string {
  if (role === 'sales_rep') return 'Sales rep';
  return role.length > 0 ? role[0]!.toUpperCase() + role.slice(1) : role;
}
