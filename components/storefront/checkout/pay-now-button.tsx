'use client';

/*
 * "Pay now" — opens a fresh Squad payment for an order that isn't paid yet.
 *
 * The server decides whether the order can still be paid and makes a new
 * attempt (Squad won't reuse a reference); this button only asks, shows that
 * it's asking, and follows the answer to Squad's page — or, in the phone app,
 * opens it in the in-app browser (lib/storefront/payments/open-payment-page.ts).
 *
 * Two ways to name the order: the confirmation token (confirmation page, any
 * visitor holding the link) or the reference (a signed-in shopper's own order
 * page, where the server matches it to their account).
 */
import { useState } from 'react';
import { Loader2, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { payForMyOrderAction, payForOrderAction } from '@/features/shop-orders/actions';
import { isNativeApp, openPaymentPage } from '@/lib/storefront/payments/open-payment-page';

type Target = { confirmationToken: string } | { reference: string };

export function PayNowButton({
  target,
  label,
  confirmationPath,
}: {
  target: Target;
  label: string;
  /** where the phone app lands once the shopper is back from Squad */
  confirmationPath: string;
}) {
  const [pending, setPending] = useState(false);

  const pay = async () => {
    if (pending) return;
    setPending(true);
    try {
      const nativeApp = isNativeApp();
      const result =
        'confirmationToken' in target
          ? await payForOrderAction(target.confirmationToken, { nativeApp })
          : await payForMyOrderAction(target.reference, { nativeApp });

      if (result.ok) {
        await openPaymentPage({ paymentUrl: result.paymentUrl, confirmationPath });
        // On the web the page is leaving, so stay "pending". In the app the
        // payment sheet is on top; the button comes back if they return.
        if (nativeApp) setPending(false);
        return;
      }
      toast.error(result.message);
    } catch {
      toast.error('We couldn’t open the payment page just now. Please try again in a moment.');
    }
    setPending(false);
  };

  return (
    <button
      type="button"
      onClick={pay}
      disabled={pending}
      aria-busy={pending}
      className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-brand px-7 text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand-hover disabled:opacity-70"
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Lock className="size-4" aria-hidden />}
      {pending ? 'Opening secure payment…' : label}
    </button>
  );
}
