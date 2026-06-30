'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import { cn } from '@/lib/cn';

const ITEMS = [
  { href: '/portal/catalog', label: 'Catalog' },
  { href: '/portal/orders', label: 'Orders' },
  { href: '/portal/invoices', label: 'Invoices' },
  { href: '/portal/account', label: 'Account' },
] as const;

/** Buyer portal top nav with the Clerk user button (buyer identity is Clerk). */
export function BuyerNav(): JSX.Element {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1">
      {ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-75',
              active ? 'bg-accent text-accent-fg' : 'text-gray-600 hover:bg-gray-100',
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
  );
}
