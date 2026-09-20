'use client';

/*
 * Sign in with an email and password.
 *
 * `next` rides in a hidden field so the shopper lands back where they were —
 * the point of signing in mid-shop is not to be dumped on a dashboard.
 * Whatever the server rejects, the email box comes back filled in.
 */
import { useActionState } from 'react';
import Link from 'next/link';
import { signInAction, type AccountFormState } from '@/features/shop-account/actions';
import { TextField } from '@/components/storefront/checkout/checkout-fields';
import { PasswordField } from './password-field';
import { SubmitButton } from './submit-button';
import { AuthError } from './auth-shell';

export function SignInForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<AccountFormState, FormData>(signInAction, null);

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />

      {state?.error && <AuthError>{state.error}</AuthError>}

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
        required
      />

      <PasswordField
        id="sf-password"
        name="password"
        label="Password"
        autoComplete="current-password"
        error={state?.fieldErrors?.password}
        action={
          <Link
            href="/account/forgot-password"
            className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Forgot password?
          </Link>
        }
        required
      />

      <SubmitButton pending={pending} pendingLabel="Signing in…">
        Sign in
      </SubmitButton>
    </form>
  );
}
