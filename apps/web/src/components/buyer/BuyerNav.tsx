'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import { Bookmark, FileText, LayoutGrid, Package, User, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const ITEMS: readonly NavItem[] = [
  { href: '/portal/catalog', label: 'Order', icon: LayoutGrid },
  { href: '/portal/orders', label: 'Orders', icon: Package },
  { href: '/portal/lists', label: 'Lists', icon: Bookmark },
  { href: '/portal/invoices', label: 'Invoices', icon: FileText },
  { href: '/portal/account', label: 'Account', icon: User },
] as const;

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Buyer portal navigation. On desktop (≥768px) a horizontal top nav with the
 * Clerk user button. On mobile it collapses to a fixed bottom tab bar (icon +
 * short label, iOS safe-area aware) while the user button stays in the header —
 * the standard mobile pattern for a task-focused portal.
 */
export function BuyerNav(): JSX.Element {
  const pathname = usePathname();

  return (
    <>
      {/* Desktop top nav */}
      <nav className="hidden items-center gap-1 md:flex">
        {ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'rounded-full px-3.5 py-1.5 text-sm font-medium transition-all duration-fast ease-spring',
                active
                  ? 'bg-gradient-to-br from-ocean-bright to-ocean-deep text-white shadow-glow'
                  : 'text-text-secondary hover:bg-white/60 hover:text-text-primary',
              )}
            >
              {item.label}
            </Link>
          );
        })}
        <div className="ml-2">
          <UserButton afterSignOutUrl="/buyer-login" />
        </div>
      </nav>

      {/* Mobile: user button in header, tabs move to the bottom bar below */}
      <div className="md:hidden">
        <UserButton afterSignOutUrl="/buyer-login" />
      </div>

      {/* Mobile bottom tab bar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex h-14 items-stretch border-t border-glass-border bg-glass-strong backdrop-blur-nav md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-label="Buyer portal navigation"
      >
        {ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors duration-fast',
                active ? 'text-ocean' : 'text-text-tertiary',
              )}
            >
              <Icon className="h-6 w-6" aria-hidden />
              <span className="text-[10px] font-medium leading-none">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
