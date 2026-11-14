'use client';

/*
 * "Delivery to be arranged" (ROADMAP 21.4B), on the buyer's order and
 * confirmation pages: waiting for the store's price, or the price itself
 * with "Accept". Accepting is the buyer's agreement to pay the new total
 * the way they chose; an online payment goes straight on to Paystack.
 * Declining is cancelling the order — the order's own cancel button, which
 * costs nothing because nothing was paid.
 *
 * The server decides everything again when they press it
 * (lib/storefront/orders/arranged.ts); this only shows where it stands.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, Loader2, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { acceptDeliveryPriceAction } from '@/features/shop-orders/actions';
import { isNativeApp, openPaymentPage } from '@/lib/storefront/payments/open-payment-page';
import { formatMoney } from '@/lib/storefront/format';
import { formatDate, formatTime } from '@/lib/format';
import type { StorefrontOrder } from '@/lib/storefront/orders/types';

const ACCEPT_LABEL: Record<string, (total: string) => string> = {
  paystack: (total) => `Accept and pay ${total}`,
  transfer: (total) => `Accept — pay ${total} by transfer`,
  pod: (total) => `Accept — pay ${total} on delivery`,
};

const at = (iso: string) => `${formatTime(iso)} on ${formatDate(iso)}`;

export function ArrangedDeliveryCard({
  order,
  confirmationToken,
  confirmationPath,
}: {
  order: Pick<StorefrontOrder, 'status' | 'paymentStatus' | 'paymentMethodId' | 'currency' | 'delivery' | 'totals'>;
  confirmationToken: string;
  /** where the phone app lands once the buyer is back from Paystack */
  confirmationPath: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const arranged = order.delivery.arranged;
  if (!arranged || arranged.accepted || order.status === 'CANCELLED' || order.paymentStatus !== 'AWAITING_DELIVERY_PRICE') {
    return null;
  }

  if (!arranged.priced) {
    return (
      <div className="rounded-2xl border border-border bg-secondary/40 p-4 text-sm">
        <p className="flex items-center gap-2 font-semibold">
          <Clock className="size-4" aria-hidden />
          Waiting for the store’s delivery price
        </p>
        <p className="mt-1.5 leading-relaxed text-muted-foreground">
          Your items are set aside. The store will work out delivery for an order this size
          {arranged.priceDueAt ? ` and send you the price by ${at(arranged.priceDueAt)}` : ''}. Nothing is charged until
          you’ve seen it and accepted. If you change your mind, cancel the order at no cost.
        </p>
      </div>
    );
  }

  const total = formatMoney(order.totals.total, order.currency);
  const label = (ACCEPT_LABEL[order.paymentMethodId] ?? ((t: string) => `Accept — total ${t}`))(total);

  const accept = async () => {
    if (pending) return;
    setPending(true);
    try {
      const nativeApp = isNativeApp();
      const result = await acceptDeliveryPriceAction(confirmationToken, { nativeApp });
      if (!result.ok) {
        toast.error(result.message);
        router.refresh();
        setPending(false);
        return;
      }
      if (result.paymentUrl) {
        await openPaymentPage({ paymentUrl: result.paymentUrl, confirmationPath });
        if (nativeApp) setPending(false);
        return;
      }
      toast.success('Delivery price accepted');
      router.refresh();
    } catch {
      toast.error('We couldn’t accept the price just now. Please try again.');
    }
    setPending(false);
  };

  return (
    <div className="rounded-2xl border border-brand/30 bg-brand/5 p-4 text-sm">
      <p className="flex items-center gap-2 font-semibold">
        <Truck className="size-4" aria-hidden />
        Your delivery price is ready
      </p>
      <dl className="mt-3 space-y-1">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Delivery, arranged by the store</dt>
          <dd className="font-medium tabular-nums">{order.delivery.fee === 0 ? 'Free' : formatMoney(order.delivery.fee, order.currency)}</dd>
        </div>
        {arranged.note && (
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">How it’s coming</dt>
            <dd className="text-right">{arranged.note}</dd>
          </div>
        )}
        <div className="flex justify-between gap-4 border-t pt-1 font-semibold">
          <dt>Order total</dt>
          <dd className="tabular-nums">{total}</dd>
        </div>
      </dl>
      <p className="mt-3 leading-relaxed text-muted-foreground">
        Accept it{arranged.acceptBy ? ` by ${at(arranged.acceptBy)}` : ''} to go ahead, or cancel the order instead —
        nothing has been charged. Unaccepted by then, the order is cancelled.
      </p>
      <button
        type="button"
        onClick={accept}
        disabled={pending}
        aria-busy={pending}
        className="mt-4 inline-flex h-12 items-center justify-center gap-2 rounded-[var(--sf-radius-button,999px)] bg-brand px-7 text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand-hover disabled:opacity-70"
      >
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {label}
      </button>
    </div>
  );
}
