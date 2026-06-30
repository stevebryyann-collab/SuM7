'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { addDays } from 'date-fns';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { BulkOrderSchema, type BulkOrderInput } from '@b2b/shared/schemas';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { ApiClientError } from '@/lib/api/error';
import { formatMoney, formatDate, formatPaymentTerms, paymentTermsDays } from '@/lib/format';
import { useCreateOrder } from '@/hooks/useCreateOrder';
import { useBnplInitiate } from '@/hooks/useBnpl';
import { useCreateStandingOrder } from '@/hooks/useStandingOrders';
import { toast } from '@/components/shared/toasts';
import { BnplSection } from './BnplSection';
import type { BuyerMe, OrderCreatedResult } from '@/types/api';

/** One line presented for review (estimates only — the server reprices on submit). */
export interface ReviewLine {
  variantId: string;
  productId: string;
  productTitle: string;
  variantLabel: string;
  sku: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

interface ReviewOrderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lines: ReviewLine[];
  /** Client-side subtotal estimate. */
  subtotal: number;
  merchantId: string;
  buyerMe: BuyerMe | undefined;
  /** Called after a successful placement (or "Place another") to clear the cart. */
  onPlaced: () => void;
}

function bnplNoticeFor(error: unknown): string {
  if (error instanceof ApiClientError && error.code === 'NO_INVOICE_FOR_ORDER') {
    return 'Your order is placed. We’ll email your Resolve financing link as soon as your invoice is ready.';
  }
  return 'Your order is placed, but we couldn’t start Resolve financing. Your order proceeds on standard terms.';
}

/**
 * Full review + placement modal. Re-states the cart (estimated unit/line totals),
 * payment terms + projected invoice/due dates, and credit usage; on submit it
 * posts via {@link useCreateOrder} with ONE idempotency key generated per modal
 * open (reused on retry so a retry never double-creates). Renders the success
 * state and maps the server's error codes (MINIMUM_ORDER_NOT_MET /
 * CREDIT_LIMIT_EXCEEDED / Shopify outage / generic). When a Resolve BNPL term is
 * selected it places the order, then initiates financing and redirects.
 */
export function ReviewOrderModal({
  open,
  onOpenChange,
  lines,
  subtotal,
  merchantId,
  buyerMe,
  onPlaced,
}: ReviewOrderModalProps): JSX.Element {
  const router = useRouter();
  const createOrder = useCreateOrder();
  const initiate = useBnplInitiate();
  const [idemKey, setIdemKey] = useState('');
  const [bnplTermDays, setBnplTermDays] = useState(0);
  const [result, setResult] = useState<OrderCreatedResult | null>(null);
  const [bnplNotice, setBnplNotice] = useState<string | null>(null);

  // Fresh idempotency key + clean slate each time the modal opens.
  useEffect(() => {
    if (open) {
      setIdemKey(crypto.randomUUID());
      setBnplTermDays(0);
      setResult(null);
      setBnplNotice(null);
      createOrder.reset();
      initiate.reset();
    }
    // createOrder/initiate are stable mutation handles; intentionally not deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const isPlacing = createOrder.isPending || initiate.isPending;
  const termsDays = paymentTermsDays(buyerMe?.paymentTerms);
  const dueDate = addDays(new Date(), termsDays);
  const creditLimit = buyerMe?.creditLimit ? Number(buyerMe.creditLimit) : null;
  const creditUsed = buyerMe?.creditUsed ? Number(buyerMe.creditUsed) : 0;

  const placeOrder = (termDays: number): void => {
    const payload: BulkOrderInput = {
      idempotencyKey: idemKey,
      merchantId,
      lineItems: lines.map((line) => ({
        shopifyProductId: line.productId,
        shopifyVariantId: line.variantId,
        quantity: line.quantity,
      })),
    };
    const parsed = BulkOrderSchema.safeParse(payload);
    if (!parsed.success) return;

    createOrder.mutate(parsed.data, {
      onSuccess: async (created) => {
        if (termDays > 0) {
          try {
            const financing = await initiate.mutateAsync({
              orderId: created.orderId,
              selectedTerms: termDays,
              idempotencyKey: `${idemKey}-bnpl`,
            });
            window.location.href = financing.redirectUrl;
            return;
          } catch (error) {
            setBnplNotice(bnplNoticeFor(error));
            setResult(created);
            return;
          }
        }
        setResult(created);
      },
    });
  };

  const error = createOrder.error instanceof ApiClientError ? createOrder.error : null;

  return (
    <Dialog open={open} onOpenChange={(next) => !isPlacing && onOpenChange(next)}>
      <DialogContent className="max-w-2xl">
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle>Order placed</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <div className="flex flex-col items-center py-6 text-center">
                <CheckCircle2 className="h-12 w-12 text-green-600" />
                <p className="mt-3 text-lg font-semibold text-gray-900">Order Placed!</p>
                <p className="mt-1 text-sm text-gray-600">
                  Order <span className="font-mono">{result.shopifyOrderNumber}</span> &middot;{' '}
                  {formatMoney(result.total)}
                </p>
                <p className="mt-2 text-sm text-gray-500">
                  Your invoice will arrive by email within 60 seconds.
                </p>
                {bnplNotice ? (
                  <p className="mt-3 max-w-md rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                    {bnplNotice}
                  </p>
                ) : null}
                <ReorderReminderPrompt orderId={result.orderId} />
              </div>
            </DialogBody>
            <DialogFooter>
              <Button
                variant="default"
                onClick={() => {
                  onOpenChange(false);
                  router.push('/portal/orders');
                }}
              >
                View order history
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  onPlaced();
                  onOpenChange(false);
                }}
              >
                Place another order
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Review your order</DialogTitle>
              <DialogDescription>
                Final pricing and totals are computed by the server when you place the order.
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="space-y-4">
              {error ? <OrderErrorBanner error={error} subtotal={subtotal} buyerMe={buyerMe} /> : null}

              <div className="overflow-hidden rounded-md border border-gray-200">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-left text-label uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">Product</th>
                      <th className="px-3 py-2 text-right font-medium">Qty</th>
                      <th className="px-3 py-2 text-right font-medium">Unit</th>
                      <th className="px-3 py-2 text-right font-medium">Line total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => (
                      <tr key={line.variantId} className="border-t border-gray-100">
                        <td className="px-3 py-1.5">
                          <span className="text-gray-900">{line.productTitle}</span>
                          {line.variantLabel && line.variantLabel !== '—' ? (
                            <span className="text-gray-400"> · {line.variantLabel}</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{line.quantity}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums text-gray-700">
                          {formatMoney(line.unitPrice)}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums text-gray-900">
                          {formatMoney(line.lineTotal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <dl className="space-y-1.5 text-sm">
                <Row label="Subtotal" value={formatMoney(subtotal)} strong />
                <Row label="Tax" value="Calculated at checkout" muted />
                <Row label="Shipping" value="As agreed" muted />
              </dl>

              <div className="space-y-1.5 border-t border-gray-200 pt-3 text-sm">
                <Row label="Payment terms" value={formatPaymentTerms(buyerMe?.paymentTerms)} />
                <Row label="Estimated invoice date" value={formatDate(new Date())} />
                <Row label="Estimated due date" value={formatDate(dueDate)} />
                <p className="pt-1 text-xs text-gray-500">
                  An invoice will be emailed to you within 60 seconds of placing your order.
                </p>
              </div>

              {creditLimit !== null ? (
                <div className="space-y-1.5 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm">
                  <Row
                    label="Credit used"
                    value={`${formatMoney(creditUsed)} of ${formatMoney(creditLimit)}`}
                  />
                  <Row
                    label="After this order"
                    value={`${formatMoney(creditUsed + subtotal)} of ${formatMoney(creditLimit)}`}
                  />
                </div>
              ) : null}

              {buyerMe?.bnplEnabled ? (
                <BnplSection
                  subtotal={subtotal}
                  selectedTermDays={bnplTermDays}
                  onSelectTermDays={setBnplTermDays}
                  disabled={isPlacing}
                />
              ) : null}
            </DialogBody>
            <DialogFooter>
              <Button variant="default" disabled={isPlacing} onClick={() => onOpenChange(false)}>
                Edit order
              </Button>
              <Button
                variant="primary"
                disabled={isPlacing || lines.length === 0}
                onClick={() => placeOrder(bnplTermDays)}
              >
                {isPlacing ? <Spinner className="h-3.5 w-3.5" /> : null}
                {error ? 'Try again' : bnplTermDays > 0 ? 'Place Order & Pay with Resolve' : 'Confirm & Place Order'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  value,
  strong,
  muted,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-gray-500">{label}</dt>
      <dd
        className={
          strong
            ? 'font-semibold tabular-nums text-gray-900'
            : muted
              ? 'text-gray-400'
              : 'tabular-nums text-gray-900'
        }
      >
        {value}
      </dd>
    </div>
  );
}

/** Maps the order-placement error codes to specific, buyer-friendly copy. */
function OrderErrorBanner({
  error,
  subtotal,
  buyerMe,
}: {
  error: ApiClientError;
  subtotal: number;
  buyerMe: BuyerMe | undefined;
}): JSX.Element {
  let message: string;
  if (error.code === 'MINIMUM_ORDER_NOT_MET' && buyerMe?.minOrderAmount) {
    const minimum = Number(buyerMe.minOrderAmount);
    const shortage = Math.max(minimum - subtotal, 0);
    message = `Minimum order is ${formatMoney(minimum)}. Your order is ${formatMoney(subtotal)}. Add ${formatMoney(shortage)} more.`;
  } else if (error.code === 'CREDIT_LIMIT_EXCEEDED' && buyerMe?.creditLimit) {
    const available = buyerMe.creditAvailable ?? '0';
    message = `This order would exceed your credit limit of ${formatMoney(buyerMe.creditLimit)}. You have ${formatMoney(available)} available.`;
  } else if (error.code === 'SHOPIFY_API_ERROR' || error.statusCode === 503) {
    message = 'We’re experiencing a temporary issue connecting to the store. Your cart has been saved — please try again.';
  } else {
    message = error.message || 'Your order could not be placed. Please try again.';
  }

  return (
    <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <p>{message}</p>
    </div>
  );
}

const REORDER_OPTIONS = [
  { days: 7, label: 'Every week' },
  { days: 14, label: 'Every 2 weeks' },
  { days: 30, label: 'Monthly' },
] as const;

/**
 * Post-placement "set a reorder reminder?" prompt. Creates a standing order tied
 * to the just-placed order; once chosen (or dismissed) it collapses to a single
 * confirmation line. Remounts fresh each time the success state is shown.
 */
function ReorderReminderPrompt({ orderId }: { orderId: string }): JSX.Element {
  const create = useCreateStandingOrder();
  const [chosen, setChosen] = useState<string | null>(null);

  const choose = (days: 7 | 14 | 30, label: string): void => {
    create.mutate(
      { sourceOrderId: orderId, frequencyDays: days },
      {
        onSuccess: () => {
          setChosen(label);
          toast.success(`We'll remind you to reorder ${label.toLowerCase()}.`);
        },
        onError: (error) =>
          toast.error(error instanceof ApiClientError ? error.message : 'Could not set reminder'),
      },
    );
  };

  if (chosen === 'none') return <span aria-hidden />;
  if (chosen) {
    return (
      <p className="mt-4 flex items-center justify-center gap-1.5 text-sm text-gray-600">
        <CheckCircle2 className="h-4 w-4 text-green-600" />
        We&apos;ll remind you to reorder {chosen.toLowerCase()}.
      </p>
    );
  }

  return (
    <div className="mt-4 w-full max-w-md rounded-md border border-gray-200 bg-gray-50 p-3 text-center">
      <p className="text-sm font-medium text-gray-900">Set a reminder to reorder?</p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {REORDER_OPTIONS.map((option) => (
          <Button
            key={option.days}
            variant="default"
            size="sm"
            disabled={create.isPending}
            onClick={() => choose(option.days, option.label)}
          >
            {option.label}
          </Button>
        ))}
        <Button variant="ghost" size="sm" disabled={create.isPending} onClick={() => setChosen('none')}>
          No thanks
        </Button>
      </div>
    </div>
  );
}
