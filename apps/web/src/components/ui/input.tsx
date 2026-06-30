'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Render the error treatment (danger border + ring). */
  error?: boolean;
}

/**
 * Text input on the design-system token scale. Focus shows an accent border +
 * 2px accent-tinted ring (the one focus affordance — no glow). Token colors
 * only; no hardcoded hex.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', error = false, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      aria-invalid={error || undefined}
      className={cn(
        'h-9 w-full rounded-md border border-border bg-surface px-3 text-base text-text-primary',
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
Input.displayName = 'Input';
