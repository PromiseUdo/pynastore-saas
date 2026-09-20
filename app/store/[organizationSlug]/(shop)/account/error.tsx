'use client';

/*
 * Anything that goes wrong in the account area.
 *
 * Never shows the raw error: a shopper can do nothing with a stack trace,
 * and this is a screen people reach while already mildly annoyed about a
 * password. One sentence, one button that retries.
 */
import { RotateCcw } from 'lucide-react';

export default function AccountError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="sf-container py-16">
      <div className="mx-auto max-w-[27rem] rounded-3xl border border-border bg-card p-8 text-center">
        <h1 className="font-display text-xl font-semibold">That didn&apos;t load</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our side. Your account is fine — try again.
        </p>
        <button
          onClick={reset}
          className="mt-5 inline-flex h-11 items-center gap-2 rounded-full bg-brand px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand-hover"
        >
          <RotateCcw className="size-4" aria-hidden />
          Try again
        </button>
      </div>
    </div>
  );
}
