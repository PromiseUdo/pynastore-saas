/*
 * "That isn't on your account."
 *
 * Used instead of `notFound()` for a record that exists but isn't this
 * shopper's — an order reference, an address id — and for one that never
 * existed. Both cases say the same thing, deliberately: telling someone
 * "that order exists, just not yours" tells them something that isn't theirs
 * to know.
 *
 * It is an in-page state rather than a 404 boundary for a practical reason
 * too: these pages sit several route groups deep, and a `notFound()` thrown
 * here renders the storefront's 404 into the account shell's content slot,
 * which came out as an empty panel — a blank page with a sidebar, and
 * nothing telling the shopper what happened.
 */
import Link from 'next/link';
import { SearchX } from 'lucide-react';

export function AccountNotFound({
  title,
  description,
  backHref,
  backLabel,
}: {
  title: string;
  description: string;
  backHref: string;
  backLabel: string;
}) {
  return (
    <div className="rounded-3xl border border-border bg-card p-8 text-center">
      <SearchX className="mx-auto size-7 text-muted-foreground" aria-hidden />
      <h1 className="mt-3 font-display text-lg font-semibold">{title}</h1>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>
      <Link
        href={backHref}
        className="mt-5 inline-flex h-11 items-center rounded-full border border-border px-5 text-sm font-semibold transition-colors hover:border-brand hover:text-brand"
      >
        {backLabel}
      </Link>
    </div>
  );
}
