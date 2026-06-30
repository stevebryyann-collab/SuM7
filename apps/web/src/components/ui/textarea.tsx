'use client';

import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Render the error treatment (danger border + ring). */
  error?: boolean;
}

/** Multiline input matching {@link Input}'s border/focus treatment. No fixed height. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error = false, ...props }, ref) => (
    <textarea
      ref={ref}
      aria-invalid={error || undefined}
      className={cn(
        'min-h-[80px] w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-text-primary',
        'transition-colors duration-fast placeholder:text-text-tertiary',
        'focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-border focus:ring-offset-0',
        'disabled:cursor-not-allowed disabled:bg-neutral-bg disabled:text-text-tertiary',
        error && 'border-danger focus:border-danger focus:ring-red-200',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';
