'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Button — design-system variants (token colors only, no hardcoded hex).
 * Transitions are color-only at duration-fast (80ms); there are no transforms
 * on press (Safari repaint safety, per CLAUDE.md).
 *
 * Variant names are backward compatible: `default` is an alias of `secondary`
 * so already-shipped `variant="default"` callers keep their intended look.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium ' +
    'transition-colors duration-fast focus-visible:outline focus-visible:outline-2 ' +
    'focus-visible:outline-accent disabled:opacity-50 disabled:cursor-not-allowed ' +
    'disabled:pointer-events-none',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-white hover:bg-accent-hover',
        secondary:
          'bg-transparent text-text-primary border border-border-strong hover:bg-neutral-bg',
        // Alias of `secondary` — retained for backward compatibility.
        default:
          'bg-transparent text-text-primary border border-border-strong hover:bg-neutral-bg',
        /**
         * Destructive (red). Used ONLY inside {@link ConfirmDialog} for
         * irreversible actions (void invoice, reject buyer). Do not use as a
         * standalone page CTA.
         */
        destructive: 'bg-danger text-white hover:bg-red-700',
        ghost:
          'bg-transparent text-text-secondary hover:text-text-primary hover:bg-neutral-bg',
        link: 'bg-transparent text-accent underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 text-base',
        sm: 'h-8 px-2 text-sm',
        lg: 'h-10 px-4 text-base',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        type={asChild ? undefined : (type ?? 'button')}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export interface LoadingButtonProps extends ButtonProps {
  /** When true: spinner overlays the label, button is disabled, width is held. */
  isLoading?: boolean;
  /** Announced to screen readers while loading (visually hidden). */
  loadingText?: string;
}

/**
 * Button that shows a centered 16px spinner while `isLoading`. The label is kept
 * mounted at `opacity-0` so the button never changes width mid-action — critical
 * for financial actions that must not visually jump as they resolve.
 */
export const LoadingButton = forwardRef<HTMLButtonElement, LoadingButtonProps>(
  ({ isLoading = false, loadingText = 'Loading', children, className, disabled, ...props }, ref) => (
    <Button
      ref={ref}
      className={cn('relative', className)}
      disabled={disabled || isLoading}
      aria-busy={isLoading}
      {...props}
    >
      {isLoading ? (
        <span className="absolute inset-0 flex items-center justify-center" aria-hidden>
          <Loader2 className="h-4 w-4 animate-spin" />
        </span>
      ) : null}
      <span className={cn('inline-flex items-center gap-2', isLoading && 'opacity-0')}>
        {children}
      </span>
      {isLoading ? <span className="sr-only">{loadingText}</span> : null}
    </Button>
  ),
);
LoadingButton.displayName = 'LoadingButton';

export { buttonVariants };
