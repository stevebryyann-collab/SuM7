'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import {
  BarChart3,
  FileText,
  LayoutDashboard,
  LineChart,
  Package,
  Settings,
  Tags,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/buyers', label: 'Buyers', icon: Users },
  { href: '/orders', label: 'Orders', icon: Package },
  { href: '/invoices', label: 'Invoices', icon: FileText },
  { href: '/pricing', label: 'Pricing', icon: Tags },
  { href: '/analytics', label: 'Analytics', icon: LineChart },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;

/**
 * Merchant admin sidebar. Secondary-panel gray-100 surface, 1px border, single
 * accent for the active item. No shadows on the container. The signed-in shop
 * domain + sign-out live at the bottom.
 */
export function MerchantNav(): JSX.Element {
  const pathname = usePathname();
  const { data: session } = useSession();

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-glass-border bg-glass-strong backdrop-blur-nav">
      <div className="flex items-center gap-2 border-b border-glass-border px-4 py-4">
        <BarChart3 className="h-5 w-5 text-ocean" />
        <span className="text-sm font-semibold text-text-primary">Wholesale</span>
      </div>

      <nav className="flex-1 space-y-1 px-2 py-3">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-fast',
                active ? 'bg-ocean-soft text-ocean-deep shadow-sm' : 'text-text-secondary hover:bg-white/60',
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-glass-border px-3 py-3">
        <p className="truncate text-xs text-text-secondary" title={session?.shopifyDomain ?? ''}>
          {session?.shopifyDomain ?? 'Not signed in'}
        </p>
        <Button
          variant="default"
          size="sm"
          className="mt-2 w-full"
          onClick={() => void signOut({ callbackUrl: '/merchant-login' })}
        >
          Sign out
        </Button>
      </div>
    </aside>
  );
}
