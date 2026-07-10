"use client";

import Link from "next/link";
import {
  ArrowRight,
  Check,
  CircleDashed,
  CreditCard,
  PackageSearch,
  Sparkles,
  Tag,
  UserCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageLayout } from "@/components/merchant/PageLayout";
import { FadeIn } from "@/components/shared/FadeIn";
import { Button } from "@/components/ui/button";
import { useDashboard } from "@/hooks/useDashboard";
import { cn } from "@/lib/cn";

/**
 * Dedicated merchant onboarding. A reviewer (and a real merchant) can land here
 * straight after install and complete setup unaided — the App Store review
 * checklist explicitly tests "merchant completes onboarding without assistance."
 *
 * Completion state is REAL, not decorative: it reads the same `setup` flags the
 * dashboard's inline checklist uses (`GET /api/v1/dashboard` → hasTier /
 * hasApprovedBuyer / hasSubscription). This page is a fuller, guided version of
 * that checklist; both retire once the store is configured. It is never a dead
 * end — a "Skip to dashboard" escape is always present.
 */

interface OnboardingStep {
  icon: LucideIcon;
  title: string;
  description: string;
  href: string;
  cta: string;
  /** true once the underlying setup signal is satisfied. */
  done: boolean;
  /** Informational steps (no completion signal) render as "Ready", not a to-do. */
  informational?: boolean;
}

export default function OnboardingPage(): JSX.Element {
  const { data, isLoading } = useDashboard();
  const setup = data?.setup;
  const hasTier = setup?.hasTier ?? false;
  const hasApprovedBuyer = setup?.hasApprovedBuyer ?? false;
  const hasSubscription = setup?.hasSubscription ?? false;

  const steps: OnboardingStep[] = [
    {
      icon: PackageSearch,
      title: "Your catalog syncs automatically",
      description:
        "Products, variants, and inventory flow in from your Shopify store over secure webhooks — nothing to import by hand. Set wholesale prices against them in the next step.",
      href: "/pricing",
      cta: "View pricing",
      done: true,
      informational: true,
    },
    {
      icon: Tag,
      title: "Create your first pricing tier",
      description:
        'Define a wholesale tier (e.g. "Stockist" or "Distributor") with its discount and volume breaks. Buyers you approve are assigned a tier to see their pricing.',
      href: "/pricing",
      cta: "Set up pricing",
      done: hasTier,
    },
    {
      icon: UserCheck,
      title: "Approve your first buyer",
      description:
        "Wholesale buyers apply from your storefront portal. Review an application, assign a pricing tier and payment terms, and approve to unlock ordering.",
      href: "/buyers",
      cta: "Review applications",
      done: hasApprovedBuyer,
    },
    {
      icon: CreditCard,
      title: "Choose a subscription plan",
      description:
        "Pick a plan to keep your portal active after the free trial. Billing runs through Paddle; you can change or cancel any time from billing settings.",
      href: "/settings/billing",
      cta: "Choose a plan",
      done: hasSubscription,
    },
  ];

  const required = steps.filter((s) => !s.informational);
  const completedCount = required.filter((s) => s.done).length;
  const allComplete = completedCount === required.length;

  return (
    <PageLayout
      title="Welcome to Wholesale Portal"
      subtitle="A few steps to start taking wholesale orders. This takes about five minutes."
    >
      <FadeIn>
        <section className="mb-6 rounded-lg border border-border bg-surface p-5 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-subtle text-accent">
                <Sparkles className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-medium text-text-primary">
                  {allComplete
                    ? "You're all set up"
                    : `Setup progress: ${completedCount} of ${required.length} complete`}
                </p>
                <p className="text-sm text-text-secondary">
                  {allComplete
                    ? "Your wholesale channel is ready. Head to the dashboard to track orders and receivables."
                    : "Complete the steps below in any order."}
                </p>
              </div>
            </div>
            {allComplete ? (
              <Button variant="primary" size="sm" asChild>
                <Link href="/dashboard">
                  Go to dashboard
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            ) : null}
          </div>

          {/* Progress bar over required steps only. */}
          <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-neutral-bg">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500"
              style={{ width: `${(completedCount / required.length) * 100}%` }}
            />
          </div>
        </section>
      </FadeIn>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {steps.map((step, i) => (
          <FadeIn key={step.title} delay={i * 40}>
            <StepCard step={step} loading={isLoading} />
          </FadeIn>
        ))}
      </div>

      <p className="mt-6 text-center text-sm text-text-tertiary">
        <Link href="/dashboard" className="hover:text-accent hover:underline">
          Skip for now — go to the dashboard
        </Link>
      </p>
    </PageLayout>
  );
}

function StepCard({
  step,
  loading,
}: {
  step: OnboardingStep;
  loading: boolean;
}): JSX.Element {
  const Icon = step.icon;
  const complete = step.done && !step.informational;
  return (
    <section className="flex h-full flex-col rounded-lg border border-border bg-surface p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-subtle text-accent">
          <Icon className="h-5 w-5" />
        </span>
        <StatusPill
          loading={loading}
          informational={step.informational}
          done={step.done}
        />
      </div>
      <h2 className="mt-4 text-base font-semibold text-text-primary">
        {step.title}
      </h2>
      <p className="mt-1 flex-1 text-sm text-text-secondary">
        {step.description}
      </p>
      <div className="mt-4">
        <Button variant={complete ? "secondary" : "primary"} size="sm" asChild>
          <Link href={step.href}>
            {complete ? "Review" : step.cta}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>
    </section>
  );
}

function StatusPill({
  loading,
  informational,
  done,
}: {
  loading: boolean;
  informational?: boolean;
  done: boolean;
}): JSX.Element {
  if (informational) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-sky-soft px-2.5 py-1 text-xs font-medium text-sky-deep">
        <Check className="h-3 w-3" />
        Automatic
      </span>
    );
  }
  if (loading) {
    return (
      <span className="h-6 w-16 animate-pulse rounded-full bg-neutral-bg" />
    );
  }
  return done ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2.5 py-1 text-xs font-medium text-success">
      <Check className="h-3 w-3" />
      Done
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-neutral-bg px-2.5 py-1 text-xs font-medium text-text-tertiary">
      <CircleDashed className="h-3 w-3" />
      To do
    </span>
  );
}
