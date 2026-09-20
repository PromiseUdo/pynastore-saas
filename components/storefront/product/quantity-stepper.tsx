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
}: {
  value: number;
  /** stock ceiling; 0 means nothing selectable */
  max: number;
  onChange: (next: number) => void;
  /** what is being counted — makes the labels unambiguous in a list of lines */
  itemLabel?: string;
  size?: 'sm' | 'lg';
  className?: string;
}) {
  const atMin = value <= 1;
  const atMax = max > 0 && value >= max;

  const step = (delta: number) => onChange(clampQuantity(value + delta, max));

  const of = itemLabel ? ` of ${itemLabel}` : '';

  const button =
    `flex ${size === 'sm' ? 'size-9' : 'size-12'} items-center justify-center transition-colors hover:bg-accent ` +
    'disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none ' +
    'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';

  return (
    <div className={cn('inline-flex items-center rounded-full border', className)}>
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={atMin}
        aria-label={`Decrease quantity${of}`}
        className={cn(button, 'rounded-l-full')}
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
        className={cn(button, 'rounded-r-full')}
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}
