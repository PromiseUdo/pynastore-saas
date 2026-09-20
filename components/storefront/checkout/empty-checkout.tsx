/*
 * Checkout with nothing to check out.
 *
 * A shopper lands here by bookmarking /checkout, by going back after
 * ordering, or by emptying the bag in another tab. None of those is an
 * error, so this reads as a signpost rather than a warning — and it is
 * shown INSTEAD of the form, because a form that computes ₦0 and has a
 * Place Order button that cannot work is worse than no form at all.
 *
 * It is not a redirect: bouncing someone to /cart the instant they arrive
 * hides what happened and makes the back button useless.
 */
import Link from 'next/link';
import { ShoppingBag } from 'lucide-react';

export function EmptyCheckout() {
  return (
    <div className="mx-auto max-w-md rounded-2xl border bg-card px-6 py-14 text-center">
      <ShoppingBag className="mx-auto size-11 text-muted-foreground/40" strokeWidth={1.25} aria-hidden />
      <h1 className="mt-5 font-display text-xl sm:text-2xl">There’s nothing to check out</h1>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
        Your bag is empty, so there’s no order to place yet. Add something and we’ll be right here.
      </p>
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Link
          href="/products"
          className="inline-flex h-11 items-center rounded-full bg-brand px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand-hover"
        >
          Start shopping
        </Link>
        <Link
          href="/cart"
          className="inline-flex h-11 items-center rounded-full border px-6 text-sm font-semibold transition-colors hover:border-brand hover:text-brand"
        >
          View your bag
        </Link>
      </div>
    </div>
  );
}
