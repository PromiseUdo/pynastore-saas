'use client';

/*
 * Radio group — the primitive that was missing from this set.
 *
 * Thin wrapper over Radix's, in the same shape as ./select.tsx and
 * ./accordion.tsx: it exists so choosing one of several options is keyboard
 * navigable (arrow keys move and select, the group is one tab stop) and
 * announced as a group, without every caller re-deriving that from divs.
 *
 * `RadioGroupCard` is the retail variant: the whole card is the label, so
 * the tap target is the card rather than a 16px dot. Selection is shown by
 * the dot AND the border — never by colour alone.
 */
import * as React from 'react';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

function RadioGroup({ className, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root data-slot="radio-group" className={cn('grid gap-3', className)} {...props} />
  );
}

function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        'aspect-square size-5 shrink-0 rounded-full border-2 border-input text-brand transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'data-[state=checked]:border-brand',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
        <span className="size-2.5 rounded-full bg-brand" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
}

/**
 * A selectable card.
 *
 * The `<label>` wraps the radio and the content, so clicking anywhere in the
 * card selects it and a screen reader reads the whole card as the option's
 * name. Selected state is carried by the border weight and the dot, not by
 * colour alone.
 */
function RadioGroupCard({
  value,
  id,
  className,
  children,
  disabled,
}: {
  value: string;
  id: string;
  className?: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex cursor-pointer items-start gap-3.5 rounded-xl border bg-card p-4 transition-colors',
        'hover:border-brand/50',
        'has-[[data-state=checked]]:border-brand has-[[data-state=checked]]:ring-1 has-[[data-state=checked]]:ring-brand',
        'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2',
        disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      <RadioGroupItem value={value} id={id} disabled={disabled} className="mt-0.5" />
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}

export { RadioGroup, RadioGroupItem, RadioGroupCard };
