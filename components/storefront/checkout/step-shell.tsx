'use client';

/*
 * The frame every checkout step sits in.
 *
 * One place decides how a step is titled, how far apart its fields sit, and
 * where its Back and Continue controls go — so the four steps cannot drift
 * apart, and the shopper's eye and thumb land in the same place each time.
 *
 * The footer is STICKY ON PHONES (`sticky bottom-0`) and in normal flow on
 * desktop. That is the one piece of fixed furniture in this flow: the
 * primary action, always reachable without scrolling past a long address
 * form, with the total beside it so nobody commits blind. It is the same
 * single element in both cases — not a duplicated CTA — so there is never
 * more than one Continue on the page.
 *
 * Back is a real <button>, first in the DOM on desktop and left of Continue,
 * because going back must be as easy as going forward (Section 29).
 */
import * as React from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function StepShell({
  id,
  title,
  description,
  children,
  onBack,
  backLabel,
  onNext,
  nextLabel,
  busy,
  /** shown above the action, e.g. the total being committed to */
  footerNote,
  /** a rejection the shopper needs to see before they press again */
  error,
}: {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
  onBack?: () => void;
  backLabel?: string;
  onNext: () => void;
  nextLabel: string;
  busy?: boolean;
  footerNote?: React.ReactNode;
  error?: string | null;
}) {
  const headingId = `${id}-heading`;

  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <header>
        <h2 id={headingId} className="font-display text-xl sm:text-2xl">
          {title}
        </h2>
        {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
      </header>

      <div className="mt-6 space-y-5">{children}</div>

      <div className="sticky bottom-0 z-10 -mx-5 mt-8 border-t bg-background/95 px-5 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-8 sm:px-8 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:py-0 lg:backdrop-blur-none">
        {error && (
          <p
            role="alert"
            className="mb-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive"
          >
            {error}
          </p>
        )}

        {footerNote && <div className="mb-3 text-sm text-muted-foreground">{footerNote}</div>}

        <div className={cn('flex items-center gap-3', onBack ? 'justify-between' : 'justify-end')}>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              /* The visible label is the step's own name ("Delivery"), which
               * on its own reads like a link forward. The accessible name
               * says which direction it goes. */
              aria-label={backLabel ? `Back to ${backLabel}` : 'Back'}
              className="inline-flex h-12 items-center gap-1.5 rounded-full px-4 text-sm font-medium text-muted-foreground transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft className="size-4" aria-hidden />
              {backLabel ?? 'Back'}
            </button>
          )}

          <button
            type="button"
            onClick={onNext}
            disabled={busy}
            aria-busy={busy || undefined}
            className="inline-flex h-12 min-w-[10rem] flex-1 items-center justify-center gap-2 rounded-full bg-brand px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 sm:flex-none"
          >
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {nextLabel}
          </button>
        </div>
      </div>
    </section>
  );
}
