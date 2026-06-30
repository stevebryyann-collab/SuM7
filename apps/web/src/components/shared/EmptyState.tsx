'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  BarChart2,
  Check,
  Copy,
  FileText,
  ShoppingCart,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface EmptyStateAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: EmptyStateAction;
  /** Smaller variant for use inside panels. */
  compact?: boolean;
  /** Override the icon color (e.g. text-danger for error states). */
  iconClassName?: string;
  /** Extra content rendered below the action (e.g. a copyable link field). */
  footer?: ReactNode;
  className?: string;
}

/** Centered empty/zero state. Token colors only; a single primary action. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact = false,
  iconClassName,
  footer,
  className,
}: EmptyStateProps): JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'px-4 py-8' : 'px-8 py-16',
        className,
      )}
    >
      <Icon size={compact ? 24 : 32} className={cn('mb-4 text-text-tertiary', iconClassName)} />
      <h3 className={cn('mb-2 font-medium text-text-primary', compact ? 'text-base' : 'text-lg')}>{title}</h3>
      <p className="max-w-xs text-sm text-text-secondary">{description}</p>
      {action ? (
        <div className="mt-6">
          {action.href ? (
            <Button variant="primary" asChild>
              <Link href={action.href}>{action.label}</Link>
            </Button>
          ) : (
            <Button variant="primary" onClick={action.onClick}>
              {action.label}
            </Button>
          )}
        </div>
      ) : null}
      {footer}
    </div>
  );
}

// ── Convenience named states ──────────────────────────────────────────────────

export function EmptyDashboard(): JSX.Element {
  return (
    <EmptyState
      icon={BarChart2}
      title="Your wholesale business starts here"
      description="Create a pricing tier and approve your first buyer to start seeing revenue."
      action={{ label: 'Create pricing tier', href: '/pricing' }}
    />
  );
}

/** Read-only application URL with an inline copy button. */
function CopyableUrl({ url }: { url: string }): JSX.Element {
  const [copied, setCopied] = useState(false);

  const copy = (): void => {
    if (!url) return;
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="mt-6 flex w-full max-w-sm items-center gap-2">
      <Input readOnly value={url} aria-label="Application link" className="text-sm" />
      <Button variant="secondary" size="default" onClick={copy} className="shrink-0">
        {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
        <span className="ml-1">{copied ? 'Copied' : 'Copy'}</span>
      </Button>
    </div>
  );
}

export function EmptyBuyerList({ applicationUrl = '' }: { applicationUrl?: string }): JSX.Element {
  return (
    <EmptyState
      icon={Users}
      title="No wholesale buyers yet"
      description="Share your application link with retailers to start receiving applications."
      footer={<CopyableUrl url={applicationUrl} />}
    />
  );
}

export function EmptyInvoiceList(): JSX.Element {
  return (
    <EmptyState
      icon={FileText}
      title="Invoices are generated automatically"
      description="When buyers place orders, invoices are created and sent within 60 seconds."
    />
  );
}

export function EmptyOrderList(): JSX.Element {
  return (
    <EmptyState
      icon={ShoppingCart}
      title="No orders yet"
      description="Approved buyers can start placing orders through your wholesale portal."
    />
  );
}

export function EmptyBuyerCatalog(): JSX.Element {
  return (
    <EmptyState
      icon={AlertCircle}
      iconClassName="text-danger"
      title="Catalog unavailable"
      description="We're having trouble loading the store catalog. Please refresh in a moment."
      action={{ label: 'Refresh page', onClick: () => window.location.reload() }}
    />
  );
}
