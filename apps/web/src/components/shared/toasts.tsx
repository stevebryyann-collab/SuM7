'use client';

import { toast as sonnerToast } from 'sonner';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';

/**
 * Typed toast helpers — the single entry point for notifications. Each level
 * carries a token-colored 16px icon and a duration tuned to severity (errors
 * and warnings linger). Built on sonner; the surface is mounted once in
 * QueryProvider. Prefer these over calling `sonner` directly.
 */
export const toast = {
  success: (message: string) =>
    sonnerToast.success(message, { icon: <CheckCircle2 size={16} className="text-success" /> }),
  error: (message: string) =>
    sonnerToast.error(message, { icon: <XCircle size={16} className="text-danger" />, duration: 6000 }),
  warning: (message: string) =>
    sonnerToast.warning(message, { icon: <AlertTriangle size={16} className="text-warning" />, duration: 8000 }),
  info: (message: string) => sonnerToast(message, { icon: <Info size={16} className="text-accent" /> }),
  loading: (message: string) => sonnerToast.loading(message),
  promise: sonnerToast.promise,
  dismiss: sonnerToast.dismiss,
};
