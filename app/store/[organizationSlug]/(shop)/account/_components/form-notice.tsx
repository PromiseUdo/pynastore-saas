'use client';

/*
 * The one place an account form says how it went.
 *
 * Success and failure share a slot so the answer always appears in the same
 * position — a shopper who pressed Save looks in one place, not two. Both
 * are announced to assistive tech: `alert` for a problem, `status` for a
 * confirmation, which is the difference between interrupting someone and
 * telling them.
 */
import { Check, TriangleAlert } from 'lucide-react';

export function FormNotice({ state }: { state: { error?: string; message?: string } | null }) {
  if (state?.error) {
    return (
      <p
        role="alert"
        className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      >
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        {state.error}
      </p>
    );
  }

  if (state?.message) {
    return (
      <p
        role="status"
        className="flex items-start gap-2 rounded-xl border border-border bg-secondary/60 px-4 py-3 text-sm"
      >
        <Check className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
        {state.message}
      </p>
    );
  }

  return null;
}
