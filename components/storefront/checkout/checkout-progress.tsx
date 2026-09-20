'use client';

/*
 * Where you are, in four words.
 *
 * Deliberately small. A checkout progress bar is navigation furniture, not
 * the content — on a phone it gets one line and a count ("Step 2 of 4") plus
 * the current step's name, because four labels wrapped across two lines at
 * the top of a form is screen real estate stolen from the form.
 *
 * SEMANTICS: an ordered list, with `aria-current="step"` on the current one
 * and a visually-hidden "completed"/"current" word on each. The ticks and
 * the weight change are visual shorthand; the state is also in the text, so
 * nothing here depends on seeing a colour.
 *
 * A step already reached is a BUTTON — going back is the whole point, and it
 * costs nothing because the form is never unmounted between steps. A step
 * not yet reached is inert, not a disabled button, so it isn't a tab stop
 * that does nothing.
 */
import { Check } from 'lucide-react';
import { CHECKOUT_STEPS, type CheckoutStepId } from '@/lib/storefront/checkout/types';
import { cn } from '@/lib/utils';

export function CheckoutProgress({
  current,
  furthest,
  onSelect,
}: {
  current: CheckoutStepId;
  /** the furthest step reached — anything up to here is navigable */
  furthest: CheckoutStepId;
  onSelect: (step: CheckoutStepId) => void;
}) {
  const index = CHECKOUT_STEPS.findIndex((s) => s.id === current);
  const furthestIndex = CHECKOUT_STEPS.findIndex((s) => s.id === furthest);

  return (
    <nav aria-label="Checkout progress">
      {/* phone: one compact line */}
      <p className="text-sm font-medium sm:hidden">
        <span className="text-muted-foreground">Step {index + 1} of {CHECKOUT_STEPS.length} · </span>
        {CHECKOUT_STEPS[index]?.label}
      </p>

      <ol className="hidden items-center gap-1.5 sm:flex">
        {CHECKOUT_STEPS.map((step, i) => {
          const done = i < index;
          const active = i === index;
          const reachable = i <= furthestIndex;

          const content = (
            <>
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold',
                  done && 'border-brand bg-brand text-primary-foreground',
                  active && !done && 'border-brand text-brand',
                  !done && !active && 'border-border text-muted-foreground',
                )}
                aria-hidden
              >
                {done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
              </span>
              <span className={cn(active ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
                {step.label}
              </span>
              <span className="sr-only">{done ? ' (completed)' : active ? ' (current step)' : ' (not yet reached)'}</span>
            </>
          );

          return (
            <li key={step.id} className="flex items-center gap-1.5">
              {reachable && !active ? (
                <button
                  type="button"
                  onClick={() => onSelect(step.id)}
                  aria-label={`${step.label} — step ${i + 1} of ${CHECKOUT_STEPS.length}, completed`}
                  className="flex items-center gap-2 rounded-full px-1 py-0.5 text-sm transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {content}
                </button>
              ) : (
                <span
                  aria-current={active ? 'step' : undefined}
                  className="flex items-center gap-2 px-1 py-0.5 text-sm"
                >
                  {content}
                </span>
              )}
              {i < CHECKOUT_STEPS.length - 1 && (
                <span className="h-px w-6 bg-border lg:w-10" aria-hidden />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
