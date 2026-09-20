'use client';

/*
 * Shared error boundary UI for every discovery surface.
 *
 * Mock data does not fail today, but the moment `catalog.ts` talks to an API
 * it will — and a results page that white-screens on a timeout is a lost
 * sale. Building the recovery path now means the switch to a real backend is
 * a data change, not a UX change.
 */
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';

export function DiscoveryError({
  reset,
  title = 'Something went wrong while loading products.',
}: {
  reset: () => void;
  title?: string;
}) {
  return (
    <div className="sf-container">
      <div className="mx-auto max-w-md py-16 text-center sm:py-24">
        <span className="mx-auto mb-5 flex size-14 items-center justify-center rounded-full bg-secondary">
          <AlertTriangle aria-hidden className="size-6 text-muted-foreground" />
        </span>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This is usually temporary. Try again, or head back to the store.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="h-11 rounded-full bg-brand px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand-hover"
          >
            Try again
          </button>
          <Link
            href="/"
            className="h-11 rounded-full border px-6 text-sm font-semibold leading-[2.75rem] transition-colors hover:border-brand hover:text-brand"
          >
            Back to store
          </Link>
        </div>
      </div>
    </div>
  );
}
