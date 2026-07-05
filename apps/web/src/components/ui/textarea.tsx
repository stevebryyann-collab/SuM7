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
        'min-h-[80px] w-full rounded-md border border-border bg-white/60 px-3.5 py-2.5 text-base text-text-primary',
        'backdrop-blur-sm transition-all duration-fast placeholder:text-text-tertiary',
        'focus:border-ocean focus:bg-white/90 focus:outline-none focus:ring-4 focus:ring-ocean/15',
        'disabled:cursor-not-allowed disabled:bg-neutral-bg/60 disabled:text-text-tertiary',
        error && 'border-coral focus:border-coral focus:ring-coral/20',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';
