import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Minimal spinning indicator (used in loading buttons and inline states). */
export function Spinner({ className }: { className?: string }): JSX.Element {
  return <Loader2 className={cn('h-4 w-4 animate-spin', className)} aria-hidden />;
}
