'use client';

/*
 * Change a password, or add the first one to a Google account.
 *
 * The current-password field only appears when there is one to prove — an
 * account that has never had a password has nothing to type there, and a
 * disabled box asking for it would just be a puzzle.
 */
import { useActionState } from 'react';
import { setPasswordAction, type ProfileFormState } from '@/features/shop-account/profile-actions';
import { PasswordField } from './password-field';
import { SubmitButton } from './submit-button';
import { FormNotice } from './form-notice';

export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [state, action, pending] = useActionState<ProfileFormState, FormData>(
    setPasswordAction,
    null,
  );

  return (
    <form action={action} className="space-y-4" noValidate>
      <FormNotice state={state} />

      {hasPassword && (
        <PasswordField
          id="current-password"
          name="currentPassword"
          label="Current password"
          autoComplete="current-password"
          error={state?.fieldErrors?.currentPassword}
          required
        />
      )}

      <PasswordField
        id="new-password"
        name="newPassword"
        label={hasPassword ? 'New password' : 'Password'}
        autoComplete="new-password"
        hint="At least 8 characters."
        error={state?.fieldErrors?.newPassword}
        required
      />

      <PasswordField
        id="confirm-new-password"
        name="confirmPassword"
        label="Confirm password"
        autoComplete="new-password"
        error={state?.fieldErrors?.confirmPassword}
        required
      />

      <div className="sm:max-w-[13rem]">
        <SubmitButton pending={pending} pendingLabel="Saving…">
          {hasPassword ? 'Change password' : 'Add password'}
        </SubmitButton>
      </div>
    </form>
  );
}
