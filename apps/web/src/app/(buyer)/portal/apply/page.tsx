'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2 } from 'lucide-react';
import {
  BuyerRegisterApplicationSchema,
  type BuyerRegisterApplicationInput,
} from '@b2b/shared/schemas';
import { PageHeader } from '@/components/shared/PageHeader';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { buyerFetch } from '@/lib/api/buyer';
import { ApiClientError } from '@/lib/api/error';

interface ApplicationResult {
  applicationId: string;
  status: 'pending';
}

/**
 * Buyer business application (pre-approval). The buyer is authenticated via Clerk
 * but not yet approved; this posts to `POST /buyer/apply` (guarded by
 * ClerkAuthenticatedGuard). Validation uses the SAME Zod schema the API enforces.
 * On success a confirmation panel replaces the form.
 */
export default function ApplyPage(): JSX.Element {
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<BuyerRegisterApplicationInput>({
    resolver: zodResolver(BuyerRegisterApplicationSchema),
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await buyerFetch<ApplicationResult>('/buyer/apply', { method: 'POST', body: values });
      setSubmitted(true);
    } catch (error) {
      setFormError(error instanceof ApiClientError ? error.message : 'Submission failed');
    }
  });

  if (submitted) {
    return (
      <div className="panel mx-auto max-w-lg p-8 text-center">
        <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-green-100">
          <CheckCircle2 className="h-5 w-5 text-green-700" />
        </div>
        <h2 className="text-base font-semibold text-gray-900">Application submitted</h2>
        <p className="mt-1 text-sm text-gray-500">
          Thanks — your wholesale application is now under review. You&apos;ll be notified by email once a
          decision has been made.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Apply for wholesale" description="Tell us about your business to request an account." />
      <form onSubmit={onSubmit} className="panel space-y-4 p-6">
        <Field label="Company name" error={errors.companyName?.message} required>
          <Input {...register('companyName')} placeholder="Acme Apparel Co." />
        </Field>
        <Field label="Email" error={errors.email?.message} required>
          <Input type="email" {...register('email')} placeholder="buyer@company.com" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Business type" error={errors.businessType?.message}>
            <Input {...register('businessType')} placeholder="Boutique / Retailer" />
          </Field>
          <Field label="Website" error={errors.website?.message}>
            <Input {...register('website')} placeholder="https://…" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Tax ID" error={errors.taxId?.message}>
            <Input {...register('taxId')} />
          </Field>
          <Field label="Phone" error={errors.phone?.message}>
            <Input {...register('phone')} />
          </Field>
        </div>
        <Field label="Estimated monthly order" error={errors.estimatedMonthlyOrder?.message}>
          <Input {...register('estimatedMonthlyOrder')} placeholder="$5,000 – $10,000" />
        </Field>
        <Field label="Message" error={errors.message?.message}>
          <Textarea rows={4} {...register('message')} placeholder="Anything else we should know?" />
        </Field>

        {formError ? <p className="text-sm text-red-700">{formError}</p> : null}

        <Button type="submit" variant="primary" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? <Spinner /> : null}
          Submit application
        </Button>
      </form>
    </div>
  );
}

function Field({
  label,
  error,
  required,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required ? <span className="ml-0.5 text-red-600">*</span> : null}
      </Label>
      {children}
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
