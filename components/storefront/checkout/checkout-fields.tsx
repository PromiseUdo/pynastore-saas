'use client';

/*
 * Checkout's form controls.
 *
 * NOT a second form system: each of these is the shared primitive from
 * components/ui (Field/FieldError/Label, Input, Select, Textarea) wearing
 * retail sizing. Two things are non-negotiable at checkout and are set here,
 * once, rather than remembered per call site:
 *
 *  1. 16px text on inputs (`text-base`). iOS Safari zooms the whole page in
 *     on focus for anything smaller, and a shopper fighting a zoomed,
 *     horizontally-scrolled form is a shopper who abandons. This is the
 *     single most consequential line in the file.
 *  2. A 44px+ target height, for thumbs.
 *
 * ACCESSIBILITY. Every control gets a real `<label for>`, and every error is
 * tied to its input with `aria-describedby` + `aria-invalid` so a screen
 * reader reads the problem when focus lands on the field rather than leaving
 * it as red text somebody has to see.
 */
import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { Field, FieldDescription, FieldError } from '@/components/ui/form-field';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const CONTROL = 'h-12 rounded-xl px-4 text-base';

function useFieldIds(id: string, error?: string, hint?: string) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;
  return { errorId, hintId, describedBy };
}

/* ---------------- text ---------------- */

type TextFieldProps = Omit<React.ComponentProps<typeof Input>, 'id'> & {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  optional?: boolean;
};

export function TextField({ id, label, error, hint, optional, className, ...props }: TextFieldProps) {
  const { errorId, hintId, describedBy } = useFieldIds(id, error, hint);

  return (
    <Field>
      <Label htmlFor={id} className="text-[0.8125rem] font-semibold">
        {label}
        {optional && <span className="ml-1.5 font-normal text-muted-foreground">(optional)</span>}
      </Label>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(CONTROL, className)}
        {...props}
      />
      {hint && !error && <FieldDescription id={hintId}>{hint}</FieldDescription>}
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </Field>
  );
}

/* ---------------- select ---------------- */

/*
 * A NATIVE select, not the Radix one in components/ui/select.tsx — the only
 * place in the storefront that chooses the platform control over ours, for
 * two reasons that only apply here:
 *
 *  - On a phone, a native select opens the OS picker: a full-height wheel
 *    with system-sized rows, which beats any listbox we can draw, and it
 *    scrolls 37 Nigerian states without fighting the page's own scroll.
 *  - It is one element with a real label and real keyboard behaviour, on the
 *    single form where a control misbehaving costs an order.
 *
 * It wears the same `CONTROL` sizing as every other field, so it is the same
 * design system, not a second one.
 */
type SelectFieldProps = Omit<React.ComponentProps<'select'>, 'id' | 'children'> & {
  id: string;
  label: string;
  options: { value: string; label: string }[];
  placeholder?: string;
  error?: string;
  hint?: string;
};

export function SelectField({
  id,
  label,
  options,
  placeholder,
  error,
  hint,
  className,
  ...props
}: SelectFieldProps) {
  const { errorId, hintId, describedBy } = useFieldIds(id, error, hint);

  return (
    <Field>
      <Label htmlFor={id} className="text-[0.8125rem] font-semibold">
        {label}
      </Label>
      <div className="relative">
        <select
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            CONTROL,
            'w-full appearance-none border bg-background pr-10 text-foreground',
            'transition-colors focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'aria-invalid:border-destructive',
            className,
          )}
          {...props}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value} className="text-foreground">
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
      </div>
      {hint && !error && <FieldDescription id={hintId}>{hint}</FieldDescription>}
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </Field>
  );
}

/* ---------------- textarea ---------------- */

type NoteFieldProps = Omit<React.ComponentProps<typeof Textarea>, 'id'> & {
  id: string;
  label: string;
  error?: string;
  hint?: string;
};

export function NoteField({ id, label, error, hint, className, ...props }: NoteFieldProps) {
  const { errorId, hintId, describedBy } = useFieldIds(id, error, hint);

  return (
    <Field>
      <Label htmlFor={id} className="text-[0.8125rem] font-semibold">
        {label}
        <span className="ml-1.5 font-normal text-muted-foreground">(optional)</span>
      </Label>
      <Textarea
        id={id}
        rows={3}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn('rounded-xl px-4 py-3 text-base', className)}
        {...props}
      />
      {hint && !error && <FieldDescription id={hintId}>{hint}</FieldDescription>}
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </Field>
  );
}

/* ---------------- layout ---------------- */

/** Two fields side by side on anything wider than a phone. */
export function FieldRow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('grid gap-4 sm:grid-cols-2', className)}>{children}</div>;
}
