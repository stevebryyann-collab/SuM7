'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Copy, ExternalLink } from 'lucide-react';
import { UpdateMerchantSettingsSchema } from '@b2b/shared/schemas';
import { PageHeader } from '@/components/shared/PageHeader';
import { SettingsTabs } from '@/components/merchant/SettingsTabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton';
import { useSettings, useUpdateSettings } from '@/hooks/useSettings';
import { ApiClientError } from '@/lib/api/error';
import { cn } from '@/lib/cn';
import type { NotificationPrefs } from '@/types/api';

const MAX_INSTRUCTIONS = 500;

type Section = 'invoice' | 'notifications';

export default function SettingsPage(): JSX.Element {
  const { data, isLoading } = useSettings();
  const update = useUpdateSettings();

  const [invoicePrefix, setInvoicePrefix] = useState('INV');
  const [paymentInstructions, setPaymentInstructions] = useState('');
  const [notifications, setNotifications] = useState<NotificationPrefs>({
    newApplication: true,
    invoiceOverdue: true,
    paymentReceived: false,
  });
  const [prefixError, setPrefixError] = useState<string | null>(null);
  const [savingSection, setSavingSection] = useState<Section | null>(null);

  // Hydrate the form once settings load.
  useEffect(() => {
    if (!data) return;
    setInvoicePrefix(data.invoicePrefix);
    setPaymentInstructions(data.paymentInstructions ?? '');
    setNotifications(data.notifications);
  }, [data]);

  const save = (section: Section): void => {
    setPrefixError(null);
    const payload = {
      invoicePrefix: invoicePrefix.trim(),
      paymentInstructions: paymentInstructions.trim() === '' ? null : paymentInstructions.trim(),
      notifications,
    };
    const parsed = UpdateMerchantSettingsSchema.safeParse(payload);
    if (!parsed.success) {
      const prefixIssue = parsed.error.issues.find((issue) => issue.path[0] === 'invoicePrefix');
      setPrefixError(prefixIssue?.message ?? 'Please check your inputs');
      if (section === 'invoice') return;
      // Notifications save shouldn't be blocked by a prefix typo — but the whole
      // object is sent, so surface the error and stop.
      return;
    }
    setSavingSection(section);
    update.mutate(parsed.data, {
      onSuccess: () => toast.success('Settings saved'),
      onError: (error) =>
        toast.error(error instanceof ApiClientError ? error.message : 'Could not save settings'),
      onSettled: () => setSavingSection(null),
    });
  };

  const copyLink = async (): Promise<void> => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.applicationLink);
      toast.success('Copied');
    } catch {
      toast.error('Could not copy link');
    }
  };

  return (
    <>
      <PageHeader title="Settings" description="General, invoice, and notification preferences." />
      <SettingsTabs />

      {isLoading || !data ? (
        <div className="panel p-6">
          <LoadingSkeleton rows={6} columns={[2, 4]} />
        </div>
      ) : (
        <div className="space-y-6">
          {/* General */}
          <section className="panel p-5">
            <h2 className="text-base font-semibold text-gray-900">General</h2>
            <p className="mt-0.5 text-sm text-gray-500">Read-only details from your Shopify store.</p>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <ReadOnlyField label="Store Name" value={data.storeName} />
              <ReadOnlyField label="Shopify Domain" value={data.shopifyDomain} />
              <ReadOnlyField label="Platform Domain" value={data.platformDomain} />
            </div>
            <div className="mt-4 space-y-1.5">
              <Label>Application Link</Label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input readOnly value={data.applicationLink} className="font-mono text-xs sm:flex-1" />
                <div className="flex items-center gap-2">
                  <Button variant="default" size="sm" onClick={() => void copyLink()}>
                    <Copy className="h-4 w-4" />
                    Copy link
                  </Button>
                  <Button variant="default" size="sm" asChild>
                    <a href={data.applicationLink} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" />
                      Test portal
                    </a>
                  </Button>
                </div>
              </div>
            </div>
          </section>

          {/* Invoice settings */}
          <section className="panel p-5">
            <h2 className="text-base font-semibold text-gray-900">Invoice Settings</h2>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:max-w-md">
              <div className="space-y-1.5">
                <Label htmlFor="invoicePrefix">Invoice Prefix</Label>
                <Input
                  id="invoicePrefix"
                  value={invoicePrefix}
                  maxLength={8}
                  onChange={(e) => setInvoicePrefix(e.target.value)}
                  placeholder="INV"
                  className="w-32"
                />
                <p className="text-xs text-gray-500">Applies to future invoices only. Max 8 characters.</p>
                {prefixError ? <p className="text-xs text-red-700">{prefixError}</p> : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="paymentInstructions">Payment Instructions</Label>
                <Textarea
                  id="paymentInstructions"
                  value={paymentInstructions}
                  maxLength={MAX_INSTRUCTIONS}
                  rows={4}
                  onChange={(e) => setPaymentInstructions(e.target.value)}
                  placeholder="e.g. Remit by ACH to…"
                />
                <p className="text-right text-xs text-gray-400">
                  {paymentInstructions.length}/{MAX_INSTRUCTIONS}
                </p>
                <p className="text-xs text-gray-500">Shown on all invoices.</p>
              </div>
            </div>
            <div className="mt-4">
              <Button
                variant="primary"
                size="sm"
                disabled={savingSection !== null}
                onClick={() => save('invoice')}
              >
                {savingSection === 'invoice' ? <Spinner /> : null}
                Save
              </Button>
            </div>
          </section>

          {/* Notifications */}
          <section className="panel p-5">
            <h2 className="text-base font-semibold text-gray-900">Notifications</h2>
            <p className="mt-0.5 text-sm text-gray-500">Owner email alerts.</p>
            <div className="mt-4 divide-y divide-gray-200 border-y border-gray-200">
              <ToggleRow
                label="New buyer application"
                description="Email the owner when a buyer applies."
                checked={notifications.newApplication}
                onChange={(v) => setNotifications((n) => ({ ...n, newApplication: v }))}
              />
              <ToggleRow
                label="Invoice overdue alert"
                description="Email the owner when an invoice becomes overdue."
                checked={notifications.invoiceOverdue}
                onChange={(v) => setNotifications((n) => ({ ...n, invoiceOverdue: v }))}
              />
              <ToggleRow
                label="Payment received confirmation"
                description="Email the owner when a payment is recorded."
                checked={notifications.paymentReceived}
                onChange={(v) => setNotifications((n) => ({ ...n, paymentReceived: v }))}
              />
            </div>
            <div className="mt-4">
              <Button
                variant="primary"
                size="sm"
                disabled={savingSection !== null}
                onClick={() => save('notifications')}
              >
                {savingSection === 'notifications' ? <Spinner /> : null}
                Save notification preferences
              </Button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input readOnly value={value} className="text-gray-600" />
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900">{label}</p>
        <p className="text-xs text-gray-500">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-75',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
          checked ? 'border-accent-dark bg-accent' : 'border-gray-300 bg-gray-200',
        )}
      >
        <span
          className={cn(
            'inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-75',
            checked ? 'translate-x-4' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}
