/*
 * The empty bag.
 *
 * Not an error state: nobody has done anything wrong by arriving here, so it
 * reads as an invitation and gives two ways back into the catalogue rather
 * than a shrug.
 */
import Link from 'next/link';
import { ShoppingBag } from 'lucide-react';

export function EmptyCart() {
  return (
    <div className="rounded-2xl border bg-card px-6 py-16 text-center">
      <ShoppingBag className="mx-auto size-12 text-muted-foreground/40" strokeWidth={1.25} aria-hidden />
      <h2 className="mt-5 font-display text-xl sm:text-2xl">Your bag is empty</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
        Looks like you haven’t added anything yet. Have a look around — anything you add will wait
        for you here.
      </p>
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Link
          href="/products"
          className="inline-flex h-11 items-center rounded-full bg-brand px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand-hover"
        >
          Continue shopping
        </Link>
        <Link
          href="/collections"
          className="inline-flex h-11 items-center rounded-full border px-6 text-sm font-semibold transition-colors hover:border-brand hover:text-brand"
        >
          Explore collections
        </Link>
      </div>
    </div>
  );
}
