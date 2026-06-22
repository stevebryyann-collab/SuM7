'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useClerk } from '@clerk/nextjs';
import {
  BuyerRegisterApplicationSchema,
  BUSINESS_TYPE_OPTIONS,
  ESTIMATED_MONTHLY_ORDER_OPTIONS,
  type BuyerRegisterApplicationInput,
} from '@b2b/shared/schemas';
import type { ApplicationStatusDto } from '@b2b/shared/types';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { buyerFetch } from '@/lib/api/buyer';
import { ApiClientError } from '@/lib/api/error';

interface ApplicationResult {
  applicationId: string;
  status: 'pending';
}

const MESSAGE_MAX = 500;

/**
 * Buyer registration application + status gate.
 *
 * On mount we fetch `GET /buyer/application-status` and branch:
 *   approved  → straight to the catalog (already a buyer here)
 *   pending   → "Under Review" status card
 *   rejected  → "Application Declined" status card
 *   suspended → suspended status card
 *   none      → the application form
 *
 * The form validates with the SAME Zod schema the API enforces; email is sourced
 * server-side from the verified Clerk identity, so it is not collected here.
 */
export default function ApplyPage(): JSX.Element {
  const [status, setStatus] = useState<ApplicationStatusDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    let active = true;
    buyerFetch<ApplicationStatusDto>('/buyer/application-status')
      .then((result) => {
        if (!active) return;
        if (result.status === 'approved') {
          router.replace('/portal/catalog');
          return;
        }
        setStatus(result);
      })
      .catch((error) => {
        if (!active) return;
        setLoadError(
          error instanceof ApiClientError ? error.message : 'Unable to load your application status',
        );
      });
    return () => {
      active = false;
    };
  }, [router]);

  if (loadError) {
    return (
      <div className="panel mx-auto max-w-lg p-6 text-sm text-red-700">
        {loadError} Please return to the store and re-open the portal.
      </div>
    );
  }

  if (!status) {
    return (
      <div className="panel mx-auto max-w-lg p-6">
        <LoadingSkeleton rows={4} columns={[2]} />
      </div>
    );
  }

  if (status.status === 'pending') {
    return <PendingCard status={status} />;
  }
  if (status.status === 'rejected') {
    return <RejectedCard status={status} />;
  }
  if (status.status === 'suspended') {
    return <SuspendedCard status={status} />;
  }

  return <ApplicationForm merchantName={status.merchantDisplayName} />;
}

// ── Status cards ───────────────────────────────────────────────────────────

function SignOutButton(): JSX.Element {
  const { signOut } = useClerk();
  const router = useRouter();
  return (
    <Button
      variant="default"
      onClick={() => void signOut().then(() => router.push('/buyer-login'))}
    >
      Sign out
    </Button>
  );
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function PendingCard({ status }: { status: ApplicationStatusDto }): JSX.Element {
  return (
    <div className="panel mx-auto max-w-lg space-y-4 p-8">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Application status</h2>
        <StatusBadge status="pending" label="Under Review" className="bg-amber-100 text-amber-800" />
      </div>
      <p className="text-sm text-gray-600">
        Your application is being reviewed by {status.merchantDisplayName}. You&apos;ll receive an email
        notification when a decision is made.
      </p>
      <dl className="text-sm text-gray-500">
        <div className="flex justify-between border-t border-gray-200 py-2">
          <dt>Applied</dt>
          <dd className="text-gray-900">{formatDateTime(status.appliedAt)}</dd>
        </div>
      </dl>
      <SignOutButton />
    </div>
  );
}

function RejectedCard({ status }: { status: ApplicationStatusDto }): JSX.Element {
  return (
    <div className="panel mx-auto max-w-lg space-y-4 p-8">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Application status</h2>
        <StatusBadge status="rejected" label="Application Declined" className="bg-gray-100 text-gray-800" />
      </div>
      <p className="text-sm text-gray-600">Your application was not approved at this time.</p>
      <p className="text-sm text-gray-500">
        If you have questions, contact{' '}
        <a href={`mailto:${status.contactEmail}`} className="text-accent">
          {status.merchantDisplayName}
        </a>
        .
      </p>
      <SignOutButton />
    </div>
  );
}

function SuspendedCard({ status }: { status: ApplicationStatusDto }): JSX.Element {
  return (
    <div className="panel mx-auto max-w-lg space-y-4 p-8">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Account status</h2>
        <StatusBadge status="suspended" label="Suspended" />
      </div>
      <p className="text-sm text-gray-600">
        Your wholesale account with {status.merchantDisplayName} is currently suspended.
      </p>
      <p className="text-sm text-gray-500">
        If you have questions, contact{' '}
        <a href={`mailto:${status.contactEmail}`} className="text-accent">
          {status.merchantDisplayName}
        </a>
        .
      </p>
      <SignOutButton />
    </div>
  );
}

// ── Application form ─────────────────────────────────────────────────────────

function ApplicationForm({ merchantName }: { merchantName: string }): JSX.Element {
  const [formError, setFormError] = useState<{ message: string; href?: string; cta?: string } | null>(
    null,
  );
  const router = useRouter();

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    watch,
    formState: { errors, isSubmitting, isValid },
  } = useForm<BuyerRegisterApplicationInput>({
    resolver: zodResolver(BuyerRegisterApplicationSchema),
    mode: 'onBlur',
  });

  const messageValue = watch('message') ?? '';

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await buyerFetch<ApplicationResult>('/buyer/apply', { method: 'POST', body: values });
      router.push('/portal/apply/success');
    } catch (error) {
      if (!(error instanceof ApiClientError)) {
        setFormError({ message: 'Submission failed. Please try again.' });
        return;
      }
      // 422 → field-level inline errors below each field.
      if (error.statusCode === 422 && error.fieldErrors.length > 0) {
        for (const fieldError of error.fieldErrors) {
          setError(fieldError.field as keyof BuyerRegisterApplicationInput, {
            type: 'server',
            message: fieldError.message,
          });
        }
        return;
      }
      // Code-specific copy (shown inline, not just a toast).
      if (error.code === 'ALREADY_APPROVED') {
        setFormError({
          message: 'You already have an approved account. Log in to access the wholesale portal.',
          href: '/buyer-login',
          cta: 'Log in',
        });
        return;
      }
      if (error.code === 'APPLICATION_PENDING') {
        setFormError({
          message:
            "Your application is currently under review. You'll receive an email when a decision is made.",
        });
        return;
      }
      if (error.code === 'RATE_LIMIT_EXCEEDED') {
        setFormError({
          message: 'Too many applications from this network. Please try again in 1 hour.',
        });
        return;
      }
      setFormError({ message: error.message });
    }
  });

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader
        title="Apply for wholesale"
        description={`Tell us about your business to request a ${merchantName} wholesale account.`}
      />
      <form onSubmit={onSubmit} className="panel space-y-4 p-6">
        <Field label="Company Name" error={errors.companyName?.message} required>
          <Input {...register('companyName')} placeholder="Acme Apparel Co." />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Business Type" error={errors.businessType?.message} required>
            <Select onValueChange={(v) => setValue('businessType', v as BuyerRegisterApplicationInput['businessType'], { shouldValidate: true })}>
              <SelectTrigger>
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {BUSINESS_TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Estimated Monthly Order" error={errors.estimatedMonthlyOrder?.message} required>
            <Select onValueChange={(v) => setValue('estimatedMonthlyOrder', v as BuyerRegisterApplicationInput['estimatedMonthlyOrder'], { shouldValidate: true })}>
              <SelectTrigger>
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {ESTIMATED_MONTHLY_ORDER_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <Field label="Website" error={errors.website?.message}>
          <Input {...register('website')} placeholder="https://…" />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Tax ID / EIN" error={errors.taxId?.message}>
            <Input {...register('taxId')} placeholder="12-3456789" />
          </Field>
          <Field label="Phone" error={errors.phone?.message}>
            <Input {...register('phone')} placeholder="+1 (555) 000-0000" />
          </Field>
        </div>

        <Field
          label="Message"
          error={errors.message?.message}
          hint={`${messageValue.length}/${MESSAGE_MAX}`}
        >
          <Textarea rows={4} maxLength={MESSAGE_MAX} {...register('message')} placeholder="Anything else we should know?" />
        </Field>

        {formError ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <p>{formError.message}</p>
            {formError.href ? (
              <a href={formError.href} className="mt-1 inline-block font-medium text-red-800 underline">
                {formError.cta ?? 'Continue'}
              </a>
            ) : null}
          </div>
        ) : null}

        <Button type="submit" variant="primary" className="w-full" disabled={!isValid || isSubmitting}>
          {isSubmitting ? <Spinner /> : null}
          {isSubmitting ? 'Submitting…' : 'Submit application'}
        </Button>
      </form>
    </div>
  );
}

function Field({
  label,
  error,
  required,
  hint,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label>
          {label}
          {required ? <span className="ml-0.5 text-red-600">*</span> : null}
        </Label>
        {hint ? <span className="text-xs text-gray-400">{hint}</span> : null}
      </div>
      {children}
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
