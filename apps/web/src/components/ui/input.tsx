'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Render the error treatment (danger border + ring). */
  error?: boolean;
}

/**
 * Text input in the glass language (CLAUDE.md → Forms). Translucent Cloud White
 * over blur, soft border, and a soft outer glow on focus (no browser outline).
 * Token colors only; no hardcoded hex.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', error = false, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      aria-invalid={error || undefined}
      className={cn(
        'h-10 w-full rounded-md border border-border bg-white/60 px-3.5 text-base text-text-primary',
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
Input.displayName = 'Input';
