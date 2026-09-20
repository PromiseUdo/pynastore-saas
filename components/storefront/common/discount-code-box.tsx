'use client';

/*
 * "Discount code" — the one place a shopper types one.
 *
 * Shown on BOTH the bag and checkout, because a shopper who adds to their
 * bag and taps Checkout in the mini-cart never passes /cart: a code box that
 * only exists on the bag page is a code box most people never find.
 *
 * It owns no money math and no rules. It hands the code to the cart store,
 * which asks the server whether this store has such a code and whether this
 * shopper may use it on this bag (lib/storefront/discounts/). What comes back
 * is a preview — the order is priced again on the server when it is placed.
 *
 * The field is always visible rather than hidden behind a "have a code?"
 * link. One empty input is a smaller distraction than a discount a customer
 * was given and cannot spend.
 */
import * as React from 'react';
import { Loader2, Tag, X } from 'lucide-react';
import { useCartStore } from '@/lib/storefront/stores/cart-store';
import { formatMoney } from '@/lib/storefront/format';

export function DiscountCodeBox({
  currency = 'NGN',
  className,
}: {
  currency?: string;
  className?: string;
}) {
  const coupon = useCartStore((s) => s.coupon);
  const items = useCartStore((s) => s.items);
  const applyCoupon = useCartStore((s) => s.applyCoupon);
  const removeCoupon = useCartStore((s) => s.removeCoupon);

  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const inputId = React.useId();

  /* A code can stop being worth anything without being wrong: the shopper
   * removed the item that took the bag over its minimum. Say what to do
   * about it rather than showing a discount row of zero. */
  const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const shortBy =
    coupon?.minSubtotal != null && subtotal < coupon.minSubtotal ? coupon.minSubtotal - subtotal : 0;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const typed = code.trim();
    if (!typed) {
      setError('Enter a code.');
      return;
    }
    setPending(true);
    setError(null);
    const result = await applyCoupon(typed);
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? 'That code isn’t valid.');
      return;
    }
    setCode('');
  }

  if (coupon) {
    return (
      <div className={className}>
        <div className="rounded-xl border border-success/30 bg-success/5 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                <Tag className="size-3.5 shrink-0 text-success" aria-hidden />
                <span className="font-mono uppercase">{coupon.code}</span>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{coupon.label}</p>
              {shortBy > 0 && (
                <p className="mt-1.5 text-xs font-medium text-sale">
                  Add {formatMoney(shortBy, currency)} more to use it.
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => removeCoupon()}
              aria-label={`Remove discount code ${coupon.code}`}
              className="-m-1 shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:text-destructive"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className={className} noValidate>
      <label htmlFor={inputId} className="text-sm font-medium">
        Discount code
      </label>
      <div className="mt-1.5 flex gap-2">
        <input
          id={inputId}
          value={code}
          onChange={(event) => {
            setCode(event.target.value.toUpperCase());
            setError(null);
          }}
          placeholder="Enter code"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${inputId}-error` : undefined}
          className="h-11 min-w-0 flex-1 rounded-full border bg-background px-4 font-mono text-sm uppercase outline-none transition-colors placeholder:font-sans placeholder:normal-case focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
        />
        <button
          type="submit"
          disabled={pending || code.trim().length === 0}
          className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-5 text-sm font-semibold transition-colors hover:border-brand hover:text-brand disabled:opacity-50 disabled:hover:border-border disabled:hover:text-foreground"
        >
          {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          Apply
        </button>
      </div>
      {error && (
        <p id={`${inputId}-error`} role="alert" className="mt-1.5 text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
