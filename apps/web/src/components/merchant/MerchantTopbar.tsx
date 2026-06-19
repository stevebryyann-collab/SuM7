'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { signOut, useSession } from 'next-auth/react';
import { ChevronDown, CreditCard, LogOut, Settings as SettingsIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Merchant top bar with an avatar dropdown (name / email, Settings, Billing,
 * Sign out). Built without a dropdown dependency — a small click-away + Escape
 * menu — to avoid adding to the locked stack. Shadow-only depth, single accent,
 * no transforms (design rules).
 */
export function MerchantTopbar(): JSX.Element {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const email = session?.shopifyDomain ?? 'Not signed in';
  const initial = (email[0] ?? 'M').toUpperCase();

  return (
    <header className="flex h-14 items-center justify-end border-b border-gray-200 bg-white px-6">
      <div className="relative" ref={ref}>
        <button
          type="button"
          className={cn(
            'flex items-center gap-2 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm',
            'shadow-sm transition-shadow duration-75 hover:bg-gray-50 active:border-gray-400 active:shadow-none',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
          )}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-fg">
            {initial}
          </span>
          <span className="hidden max-w-[180px] truncate text-gray-700 sm:inline">{email}</span>
          <ChevronDown className="h-4 w-4 text-gray-500" />
        </button>

        {open ? (
          <div
            role="menu"
            className="absolute right-0 z-50 mt-1 w-60 overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm"
          >
            <div className="border-b border-gray-200 px-3 py-2.5">
              <p className="truncate text-sm font-medium text-gray-900">
                {session?.role ? roleLabel(session.role) : 'Merchant'}
              </p>
              <p className="truncate text-xs text-gray-500" title={email}>
                {email}
              </p>
            </div>
            <nav className="py-1">
              <MenuLink href="/settings" icon={<SettingsIcon className="h-4 w-4" />} onSelect={() => setOpen(false)}>
                Settings
              </MenuLink>
              <MenuLink
                href="/settings/billing"
                icon={<CreditCard className="h-4 w-4" />}
                onSelect={() => setOpen(false)}
              >
                Billing
              </MenuLink>
            </nav>
            <div className="border-t border-gray-200 py-1">
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                onClick={() => {
                  setOpen(false);
                  void signOut({ callbackUrl: '/merchant-login' });
                }}
              >
                <LogOut className="h-4 w-4 text-gray-500" />
                Sign out
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </header>
  );
}

function MenuLink({
  href,
  icon,
  children,
  onSelect,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  onSelect: () => void;
}): JSX.Element {
  return (
    <Link
      href={href}
      role="menuitem"
      className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
      onClick={onSelect}
    >
      <span className="text-gray-500">{icon}</span>
      {children}
    </Link>
  );
}

function roleLabel(role: string): string {
  return role.length > 0 ? role[0]!.toUpperCase() + role.slice(1) : role;
}
