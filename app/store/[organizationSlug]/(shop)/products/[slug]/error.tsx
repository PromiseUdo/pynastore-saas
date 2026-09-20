'use client';

/*
 * Something went wrong LOADING the product — distinct from the product not
 * existing, which is a 404 (see not-found.tsx). Retry is the useful action
 * here, so it leads rather than the navigation links.
 */
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';

export default function ProductError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="sf-container py-20">
      <div className="mx-auto max-w-md text-center">
        <span className="mx-auto mb-5 flex size-14 items-center justify-center rounded-full bg-secondary">
          <RefreshCw aria-hidden className="size-6 text-muted-foreground" />
        </span>
        <h1 className="font-display text-2xl">We couldn’t load this product</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          That is on us, not on you. Try again — if it keeps happening, the product page may be
          temporarily unavailable.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="h-11 rounded-full bg-brand px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand-hover"
          >
            Try again
          </button>
          <Link
            href="/products"
            className="h-11 rounded-full border px-5 text-sm font-semibold leading-[2.75rem] transition-colors hover:border-brand hover:text-brand"
          >
            Browse all products
          </Link>
        </div>
      </div>
    </div>
  );
}
