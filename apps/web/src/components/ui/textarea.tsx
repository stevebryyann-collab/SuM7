'use client';

import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/** Recessed multiline input. Matches {@link Input}'s shadow-inner depth cue. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-900',
        'shadow-inner transition-colors duration-75 placeholder:text-gray-400',
        'focus:border-gray-400 focus:bg-white focus:outline-none focus:ring-0',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';
