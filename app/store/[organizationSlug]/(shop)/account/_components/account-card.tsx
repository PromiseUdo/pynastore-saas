/*
 * The card every account section sits in, and the labelled row inside it.
 *
 * One shape for all of them so the overview and the profile read as the same
 * page rather than two designs that happen to share a sidebar — and so the
 * parts still to come (orders, addresses) have something to be built from.
 */
import * as React from 'react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

/*
 * A card's action link. Given a real height and a negative margin so it
 * keeps its place visually while meeting the 32px touch target the admin and
 * storefront both hold themselves to — at 20px tall these were a thumb's
 * coin toss on a phone.
 */
export function CardAction({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="-mr-2 -mt-1.5 inline-flex h-9 items-center rounded-lg px-2 text-sm font-medium text-brand underline underline-offset-4"
    >
      {children}
    </Link>
  );
}

export function AccountCard({
  title,
  description,
  action,
  /* A page whose whole content is one card (adding an address) makes that
   * card's title the page heading, rather than repeating it above. */
  titleAs: Title = 'h2',
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  titleAs?: 'h1' | 'h2';
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-border bg-card p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Title className="text-sm font-semibold">{title}</Title>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** A labelled fact. Shows a dash rather than a blank when there's nothing. */
export function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string | null;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="break-words text-sm">{value || '—'}</dd>
      </div>
    </div>
  );
}
