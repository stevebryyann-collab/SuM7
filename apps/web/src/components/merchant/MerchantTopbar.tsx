'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { signOut, useSession } from 'next-auth/react';
import { ChevronDown, CreditCard, LogOut, Settings as SettingsIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Merchant top bar with an avatar dropdown (name / email, Settings, Billing,
 * Sign out). Built without a dropdown dependency — a small click-away + Escape
 * menu — to avoid adding to the locked stack. Glass sticky bar over the
 * atmospheric sky, glass dropdown (CLAUDE.md → Navigation / Glass System).
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
    <header className="sticky top-0 z-30 flex h-14 items-center justify-end border-b border-glass-border bg-glass-strong px-6 backdrop-blur-nav">
      <div className="relative" ref={ref}>
        <button
          type="button"
          className={cn(
            'flex items-center gap-2 rounded-full border border-glass-border bg-white/60 px-2 py-1.5 text-sm',
            'shadow-sm backdrop-blur-sm transition-all duration-fast ease-spring hover:-translate-y-0.5 hover:bg-white hover:shadow-glass active:scale-[0.98]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean/40',
          )}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-ocean-bright to-ocean-deep text-xs font-semibold text-white">
            {initial}
          </span>
          <span className="hidden max-w-[180px] truncate text-text-secondary sm:inline">{email}</span>
          <ChevronDown className="h-4 w-4 text-text-tertiary" />
        </button>

        {open ? (
          <div
            role="menu"
            className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-xl border border-glass-border bg-glass-strong shadow-glass backdrop-blur-glass animate-in fade-in-0 zoom-in-95"
          >
            <div className="border-b border-glass-border px-3 py-2.5">
              <p className="truncate text-sm font-medium text-text-primary">
                {session?.role ? roleLabel(session.role) : 'Merchant'}
              </p>
              <p className="truncate text-xs text-text-secondary" title={email}>
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
            <div className="border-t border-glass-border py-1">
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-primary transition-colors hover:bg-ocean-soft"
                onClick={() => {
                  setOpen(false);
                  void signOut({ callbackUrl: '/merchant-login' });
                }}
              >
                <LogOut className="h-4 w-4 text-text-tertiary" />
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
      className="flex items-center gap-2 px-3 py-2 text-sm text-text-primary transition-colors hover:bg-ocean-soft"
      onClick={onSelect}
    >
      <span className="text-text-tertiary">{icon}</span>
      {children}
    </Link>
  );
}

function roleLabel(role: string): string {
  return role.length > 0 ? role[0]!.toUpperCase() + role.slice(1) : role;
}
