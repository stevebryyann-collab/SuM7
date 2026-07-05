'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { PageHeaderSkeleton } from '@/components/shared/LoadingSkeleton';

/**
 * The single content wrapper for every merchant admin page: a centered 1200px
 * column, a consistent title/subtitle header, and an optional primary action.
 * The merchant route-group layout owns the chrome (sidebar + top bar); this owns
 * the page's max-width, padding, and header so spacing never drifts page to page.
 *
 * Detail/sub pages with bespoke headers (back links, tabs) use the exported
 * {@link PageContainer} directly to get the same column without the title block.
 */

/** Shared 1200px column. Used by PageLayout and by detail pages with custom headers. */
export function PageContainer({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return <div className={cn('mx-auto max-w-[1200px] px-12 py-8', className)}>{children}</div>;
}

export interface PageLayoutAction {
  label: string;
  onClick?: () => void;
  href?: string;
  icon?: LucideIcon;
}

export interface PageLayoutProps {
  title: string;
  subtitle?: string;
  /** Structured single primary action (rendered as the accent button). */
  action?: PageLayoutAction;
  /** Arbitrary header-right content (filters, secondary buttons). */
  headerActions?: ReactNode;
  isLoading?: boolean;
  children: ReactNode;
}

export function PageLayout({
  title,
  subtitle,
  action,
  headerActions,
  isLoading = false,
  children,
}: PageLayoutProps): JSX.Element {
  const ActionIcon = action?.icon;

  return (
    <PageContainer>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          {isLoading ? (
            <PageHeaderSkeleton />
          ) : (
            <>
              <h1 className="text-3xl font-bold tracking-tight text-text-primary">{title}</h1>
              {subtitle ? <p className="mt-1.5 text-base text-text-secondary">{subtitle}</p> : null}
            </>
          )}
        </div>

        {headerActions || action ? (
          <div className="flex shrink-0 items-center gap-2">
            {headerActions}
            {action ? (
              action.href ? (
                <Button variant="primary" asChild>
                  <Link href={action.href}>
                    {ActionIcon ? <ActionIcon className="h-4 w-4" /> : null}
                    {action.label}
                  </Link>
                </Button>
              ) : (
                <Button variant="primary" onClick={action.onClick}>
                  {ActionIcon ? <ActionIcon className="h-4 w-4" /> : null}
                  {action.label}
                </Button>
              )
            ) : null}
          </div>
        ) : null}
      </div>
      {children}
    </PageContainer>
  );
}
