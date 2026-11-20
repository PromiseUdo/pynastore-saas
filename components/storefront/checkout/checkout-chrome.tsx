/*
 * The checkout's header: a wordmark, a way back, one reassurance.
 *
 * A Server Component — it has no state and no interaction of its own, so it
 * costs the client nothing. The one piece that does need the browser is the
 * wordmark, which reads the org out of the storefront context; it is its own
 * small Client Component (./store-wordmark.tsx) so this header doesn't
 * become a client tree just to print a name.
 *
 * Sticky, so the shop's logo, "Secure checkout" and the way back to the bag
 * stay in view through a long form. Kept short on phones (h-14) so it costs
 * the form as little room as possible, and it sits below the phone's status
 * bar inside the shop's own app (--inset-top), like the site header. The
 * layout keeps focused fields and the order summary clear of it.
 */
import Link from 'next/link';
import { ArrowLeft, Lock } from 'lucide-react';
import { StoreWordmark } from './store-wordmark';

export function CheckoutChrome() {
  return (
    <header className="sticky top-[var(--inset-top)] z-40 border-b bg-background">
      <div className="sf-container flex h-14 items-center justify-between gap-4 sm:h-16">
        <StoreWordmark />

        <div className="flex items-center gap-4">
          <p className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
            <Lock className="size-3.5" aria-hidden />
            Secure checkout
          </p>
          <Link
            href="/cart"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-brand"
          >
            <ArrowLeft className="size-4" aria-hidden />
            <span className="hidden sm:inline">Back to bag</span>
            <span className="sm:hidden">Bag</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
