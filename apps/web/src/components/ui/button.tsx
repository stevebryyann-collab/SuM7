'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Button — design-system variants (token colors only, no hardcoded hex).
 * The Apple-Weather glass language (CLAUDE.md): primary is an Ocean Blue
 * gradient with a soft glow, secondary/default is translucent glass, and every
 * solid button lifts on hover and presses on click with spring easing.
 *
 * Variant names are backward compatible: `default` is an alias of `secondary`
 * so already-shipped `variant="default"` callers keep their intended look.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium ' +
    'transition-all duration-fast ease-spring active:scale-[0.97] ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean/40 ' +
    'focus-visible:ring-offset-2 focus-visible:ring-offset-transparent ' +
    'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none',
  {
    variants: {
      variant: {
        primary:
          'bg-gradient-to-br from-ocean-bright via-ocean to-ocean-deep text-white ' +
          'shadow-glow hover:-translate-y-0.5 hover:shadow-glow-hover',
        secondary:
          'bg-glass-strong backdrop-blur-nav text-text-primary border border-glass-border ' +
          'shadow-sm hover:-translate-y-0.5 hover:bg-white hover:shadow-glass',
        // Alias of `secondary` — retained for backward compatibility.
        default:
          'bg-glass-strong backdrop-blur-nav text-text-primary border border-glass-border ' +
          'shadow-sm hover:-translate-y-0.5 hover:bg-white hover:shadow-glass',
        /**
         * Destructive (Coral). Used ONLY inside {@link ConfirmDialog} for
         * irreversible actions (void invoice, reject buyer). Do not use as a
         * standalone page CTA.
         */
        destructive:
          'bg-gradient-to-br from-coral via-coral to-coral-deep text-white ' +
          'shadow-md hover:-translate-y-0.5 hover:shadow-lg',
        ghost:
          'bg-transparent text-text-secondary hover:text-text-primary hover:bg-white/60 ' +
          'hover:backdrop-blur-sm active:scale-100',
        link: 'bg-transparent text-ocean underline-offset-4 hover:underline active:scale-100',
      },
      size: {
        default: 'h-10 px-4 text-base',
        sm: 'h-8 px-3 text-sm',
        lg: 'h-11 px-5 text-md',
        icon: 'h-10 w-10',
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
