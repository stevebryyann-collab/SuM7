import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface FormFieldProps {
  /** Field label text. */
  label: string;
  /** Append a danger-colored asterisk to the label. */
  required?: boolean;
  /** Error message — when set, replaces the hint and is shown in danger. */
  error?: string;
  /** Helper text shown below the control when there is no error. */
  hint?: string;
  /** Associates the label with the control via htmlFor / id. */
  htmlFor?: string;
  /** The input / select / textarea (or any control). */
  children: ReactNode;
  className?: string;
}

/**
 * Consistent labelled form-field wrapper: label (+ optional required marker),
 * the control, and a single message line that is either the error (danger) or
 * the hint (secondary). Token colors only.
 */
export function FormField({
  label,
  required = false,
  error,
  hint,
  htmlFor,
  children,
  className,
}: FormFieldProps): JSX.Element {
  return (
    <div className={cn('flex flex-col', className)}>
      <label htmlFor={htmlFor} className="mb-1.5 text-sm font-medium text-text-primary">
        {label}
        {required ? <span className="ml-0.5 text-danger">*</span> : null}
      </label>
      {children}
      {error ? (
        <p className="mt-1 text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-text-secondary">{hint}</p>
      ) : null}
    </div>
  );
}
