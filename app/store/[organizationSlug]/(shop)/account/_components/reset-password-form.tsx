'use client';

/*
 * Choose a new password.
 *
 * Confirming it twice is worth the extra field here: this is the one form
 * where a typo locks someone out of the account they are in the middle of
 * recovering. On success the server signs them straight in — see
 * resetPasswordAction.
 */
import { useActionState } from 'react';
import { resetPasswordAction, type AccountFormState } from '@/features/shop-account/actions';
import { PasswordField } from './password-field';
import { SubmitButton } from './submit-button';
import { AuthError } from './auth-shell';

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<AccountFormState, FormData>(
    resetPasswordAction,
    null,
  );

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="token" value={token} />

      {state?.error && <AuthError>{state.error}</AuthError>}

      <PasswordField
        id="sf-password"
        name="password"
        label="New password"
        autoComplete="new-password"
        hint="At least 8 characters."
        error={state?.fieldErrors?.password}
        required
      />

      <PasswordField
        id="sf-confirm-password"
        name="confirmPassword"
        label="Confirm new password"
        autoComplete="new-password"
        error={state?.fieldErrors?.confirmPassword}
        required
      />

      <SubmitButton pending={pending} pendingLabel="Saving…">
        Save new password
      </SubmitButton>
    </form>
  );
}
