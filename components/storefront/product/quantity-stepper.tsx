'use client';

/*
 * Quantity stepper.
 *
 * The buttons are real buttons with real labels ("Decrease quantity"), and
 * the value is a live region — a stepper whose only feedback is a number
 * changing is invisible to a screen reader. Clamping lives in
 * lib/storefront/variant-selection.ts so "never below 1, never above stock"
 * is tested once rather than re-implemented per caller.
 */
import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { clampQuantity } from '@/lib/storefront/variant-selection';

export function QuantityStepper({
  value,
  max,
  onChange,
  itemLabel,
  size = 'lg',
  className,
  step: stepBy = 1,
}: {
  value: number;
  /** stock ceiling; 0 means nothing selectable */
  max: number;
  onChange: (next: number) => void;
  /** what is being counted — makes the labels unambiguous in a list of lines */
  itemLabel?: string;
  size?: 'sm' | 'lg';
  className?: string;
  /** move in whole packs of this many — a trade buyer's carton (ROADMAP 21.3) */
  step?: number;
}) {
  const pack = stepBy > 1 ? Math.floor(stepBy) : 1;
  const atMin = value <= pack;
  const atMax = max > 0 && value + pack > max;

  const step = (delta: number) => {
    const next = clampQuantity(value + delta * pack, max);
    // Whole packs only, and never less than one.
    onChange(pack > 1 ? Math.max(pack, Math.floor(next / pack) * pack) : next);
  };

  const of = itemLabel ? ` of ${itemLabel}` : '';

  const button =
    `flex ${size === 'sm' ? 'size-9' : 'size-12'} items-center justify-center transition-colors hover:bg-accent ` +
    'disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none ' +
    'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';

  return (
    <div className={cn('inline-flex items-center rounded-(--sf-radius-button) border', className)}>
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={atMin}
        aria-label={`Decrease quantity${of}`}
        className={cn(button, 'rounded-l-(--sf-radius-button)')}
      >
        <Minus className="size-4" />
      </button>

      <span
        aria-live="polite"
        aria-atomic="true"
        className={cn('text-center text-sm font-semibold tabular-nums', size === 'sm' ? 'w-8' : 'w-10')}
      >
        <span className="sr-only">{itemLabel ? `${itemLabel} quantity: ` : 'Quantity: '}</span>
        {value}
      </span>

      <button
        type="button"
        onClick={() => step(1)}
        disabled={atMax || max <= 0}
        aria-label={`Increase quantity${of}`}
        className={cn(button, 'rounded-r-(--sf-radius-button)')}
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}
