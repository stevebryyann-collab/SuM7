'use client';

import type { ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button, LoadingButton } from '@/components/ui/button';

/**
 * Confirmation dialog built on Radix AlertDialog, redesigned to the token
 * system. `destructive` turns the confirm button red; `isLoading` shows a
 * spinner and disables BOTH buttons so a financial action (mark paid, void,
 * reject) can't be double-submitted. `children` embeds form content — e.g. a
 * rejection-reason field — between the description and the footer.
 */
export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string | ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  isLoading?: boolean;
  onConfirm: () => void | Promise<void>;
  children?: ReactNode;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  isLoading = false,
  onConfirm,
  children,
}: ConfirmDialogProps): JSX.Element {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !isLoading && onOpenChange(next)}>
      <AlertDialogContent className="rounded-xl border-border bg-surface shadow-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-xl font-semibold text-text-primary">{title}</AlertDialogTitle>
          {description ? (
            <AlertDialogDescription className="mt-2 text-sm text-text-secondary">
              {description}
            </AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>

        {children ? <div className="mt-4">{children}</div> : null}

        <AlertDialogFooter className="mt-6 gap-3">
          <AlertDialogCancel asChild>
            <Button variant="secondary" disabled={isLoading}>
              {cancelLabel}
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <LoadingButton
              variant={destructive ? 'destructive' : 'primary'}
              isLoading={isLoading}
              onClick={(event) => {
                // Keep the dialog open until the caller resolves the action.
                event.preventDefault();
                void onConfirm();
              }}
            >
              {confirmLabel}
            </LoadingButton>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
