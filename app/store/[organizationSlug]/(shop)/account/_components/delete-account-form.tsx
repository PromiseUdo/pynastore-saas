'use client';

/*
 * Deleting the account, with the consequences said before the button, and
 * one more proof that it's really them — their password, or for a Google
 * account, their email typed out.
 */
import { useActionState } from 'react';
import { deleteAccountAction, type DeleteAccountState } from '@/features/shop-account/data-actions';
import { TextField } from '@/components/storefront/checkout/checkout-fields';
import { PasswordField } from './password-field';
import { SubmitButton } from './submit-button';
import { FormNotice } from './form-notice';

export function DeleteAccountForm({ hasPassword, email }: { hasPassword: boolean; email: string }) {
  const [state, action, pending] = useActionState<DeleteAccountState, FormData>(deleteAccountAction, null);

  return (
    <form action={action} className="space-y-4" noValidate>
      <FormNotice state={state} />
      {hasPassword ? (
        <PasswordField
          id="delete-confirm"
          name="confirm"
          label="Your password"
          autoComplete="current-password"
          error={state?.fieldErrors?.confirm}
          required
        />
      ) : (
        <TextField
          id="delete-confirm"
          name="confirm"
          type="email"
          label="Your email address"
          hint={`Type ${email} to confirm.`}
          autoComplete="off"
          error={state?.fieldErrors?.confirm}
          required
        />
      )}
      <div className="sm:max-w-[16rem]">
        <SubmitButton pending={pending} pendingLabel="Deleting…" variant="danger">
          Delete my account
        </SubmitButton>
      </div>
    </form>
  );
}
