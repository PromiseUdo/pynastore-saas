'use client';

/*
 * A password box with a show/hide toggle.
 *
 * The toggle is not decoration: on a phone, typing a password blind is the
 * single most common reason a sign-in fails twice in a row. It is a real
 * button with an `aria-label` that changes with its state, and it never
 * submits the form.
 *
 * Sizing matches the checkout fields it sits beside (h-12, 16px text — small
 * text makes iOS Safari zoom the page on focus).
 */
import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Field, FieldDescription, FieldError } from '@/components/ui/form-field';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

export function PasswordField({
  id,
  label,
  error,
  hint,
  action,
  ...props
}: Omit<React.ComponentProps<typeof Input>, 'id' | 'type'> & {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  /** e.g. the "Forgot password?" link, shown beside the label */
  action?: React.ReactNode;
}) {
  const [visible, setVisible] = React.useState(false);
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  return (
    <Field>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id} className="text-[0.8125rem] font-semibold">
          {label}
        </Label>
        {action}
      </div>
      <div className="relative">
        <Input
          id={id}
          type={visible ? 'text' : 'password'}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="h-12 rounded-xl px-4 pr-12 text-base"
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          className="absolute right-1.5 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {visible ? <EyeOff className="size-4.5" /> : <Eye className="size-4.5" />}
        </button>
      </div>
      {hint && !error && <FieldDescription id={hintId}>{hint}</FieldDescription>}
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </Field>
  );
}
