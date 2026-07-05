'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

/**
 * Cursor pagination control. There are deliberately NO page numbers — the API
 * is cursor-based only (never skip/offset). Prev is enabled only when prior
 * cursors exist; Next only when the server reports another page. While fetching
 * the next page both buttons disable and a spinner shows.
 */
export interface CursorPaginationProps {
  hasPrevious: boolean;
  hasNext: boolean;
  isLoading?: boolean;
  onPrevious: () => void;
  onNext: () => void;
  /** Optional context line, e.g. "Showing 20 of many". */
  caption?: string;
}

export function CursorPagination({
  hasPrevious,
  hasNext,
  isLoading = false,
  onPrevious,
  onNext,
  caption,
}: CursorPaginationProps): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border px-4 py-2.5">
      <div className="flex items-center gap-2 text-xs text-text-secondary">
        {isLoading && <Spinner className="h-3.5 w-3.5" />}
        {caption ? <span>{caption}</span> : null}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="default"
          size="sm"
          onClick={onPrevious}
          disabled={!hasPrevious || isLoading}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
          Prev
        </Button>
        <Button
          variant="default"
          size="sm"
          onClick={onNext}
          disabled={!hasNext || isLoading}
          aria-label="Next page"
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
