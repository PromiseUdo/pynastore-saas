'use client';

/*
 * Ask for a reset link.
 *
 * The confirmation is the same sentence whether or not that address has an
 * account here — this form must not become a way to find out who shops at
 * this store. On success the form is replaced by the message rather than
 * sitting there inviting a second send.
 */
import { useActionState } from 'react';
import { MailCheck } from 'lucide-react';
import { forgotPasswordAction, type AccountFormState } from '@/features/shop-account/actions';
import { TextField } from '@/components/storefront/checkout/checkout-fields';
import { SubmitButton } from './submit-button';

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<AccountFormState, FormData>(
    forgotPasswordAction,
    null,
  );

  if (state?.message) {
    return (
      <div className="rounded-2xl border border-border bg-secondary/50 p-5 text-center">
        <MailCheck className="mx-auto size-6 text-brand" aria-hidden />
        <p className="mt-3 text-sm text-foreground">{state.message}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          The link works once and expires in 30 minutes. Check your spam folder if it doesn&apos;t
          arrive.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4" noValidate>
      <TextField
        id="sf-email"
        name="email"
        label="Email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="you@example.com"
        defaultValue={state?.values?.email}
        required
      />

      <SubmitButton pending={pending} pendingLabel="Sending…">
        Email me a link
      </SubmitButton>
    </form>
  );
}
