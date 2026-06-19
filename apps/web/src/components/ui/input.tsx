'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * Recessed text input. `shadow-inner` is the only depth cue (no focus glow ring,
 * per CLAUDE.md). On focus the surface lifts from gray-50 to white.
 */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = 'text', ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        'h-9 w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-900',
        'shadow-inner transition-colors duration-75 placeholder:text-gray-400',
        'focus:border-gray-400 focus:bg-white focus:outline-none focus:ring-0',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
