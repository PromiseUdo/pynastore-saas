'use client';

/*
 * Create an account: name, email, password. Three fields, and no more.
 *
 * Phone and address are NOT asked for here. Checkout collects them when they
 * are actually needed, and saves them then (Part 3) — asking up front for
 * things a shopper hasn't needed yet is how a sign-up gets abandoned.
 */
import { useActionState } from 'react';
import { registerAction, type AccountFormState } from '@/features/shop-account/actions';
import { TextField } from '@/components/storefront/checkout/checkout-fields';
import { PasswordField } from './password-field';
import { SubmitButton } from './submit-button';
import { AuthError } from './auth-shell';

export function RegisterForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<AccountFormState, FormData>(registerAction, null);

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />

      {state?.error && <AuthError>{state.error}</AuthError>}

      <TextField
        id="sf-name"
        name="name"
        label="Full name"
        autoComplete="name"
        placeholder="Ada Okafor"
        defaultValue={state?.values?.name}
        error={state?.fieldErrors?.name}
        required
      />

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
        error={state?.fieldErrors?.email}
        hint="We'll send order updates here."
        required
      />

      <PasswordField
        id="sf-password"
        name="password"
        label="Password"
        autoComplete="new-password"
        hint="At least 8 characters."
        error={state?.fieldErrors?.password}
        required
      />

      <SubmitButton pending={pending} pendingLabel="Creating your account…">
        Create account
      </SubmitButton>
    </form>
  );
}
