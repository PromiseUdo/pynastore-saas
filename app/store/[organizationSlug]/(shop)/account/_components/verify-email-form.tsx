'use client';

/*
 * Type the code, or ask for a new one (ROADMAP 20.1).
 *
 * Two forms on one card: the code, and "Send a new code". When the code has
 * expired or been guessed at too often, the code box is pointless, so the
 * card says why and leads with the resend instead.
 */
import { useActionState } from 'react';
import {
  resendVerificationCodeAction,
  verifyEmailAction,
  type AccountFormState,
} from '@/features/shop-account/actions';
import { TextField } from '@/components/storefront/checkout/checkout-fields';
import { SubmitButton } from './submit-button';
import { AuthError } from './auth-shell';
import { FormNotice } from './form-notice';

export function VerifyEmailForm({
  next,
  email,
  expired,
  locked,
}: {
  next: string;
  email: string;
  expired: boolean;
  locked: boolean;
}) {
  const [state, action, pending] = useActionState<AccountFormState, FormData>(verifyEmailAction, null);
  const [resent, resend, resending] = useActionState<AccountFormState, FormData>(
    resendVerificationCodeAction,
    null,
  );

  // A fresh code makes an expired or spent one irrelevant.
  const needsNewCode = (expired || locked) && !resent?.message;

  return (
    <div className="space-y-5">
      <p className="text-sm">
        We sent a 6-digit code to <span className="break-all font-medium">{email}</span>. It can take a
        minute to arrive, so check your spam folder too.
      </p>

      {needsNewCode ? (
        <AuthError>
          {locked ? 'Too many tries with that code.' : 'That code has expired.'} Send yourself a new one.
        </AuthError>
      ) : (
        <form action={action} className="space-y-4" noValidate>
          <input type="hidden" name="next" value={next} />
          {state?.error && <AuthError>{state.error}</AuthError>}
          <TextField
            id="sf-code"
            name="code"
            label="Code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={7}
            placeholder="123456"
            error={state?.fieldErrors?.code}
            className="text-center text-lg tracking-[0.4em] tabular-nums"
            required
            autoFocus
          />
          <SubmitButton pending={pending} pendingLabel="Confirming…">
            Confirm email
          </SubmitButton>
        </form>
      )}

      <form action={resend} className="space-y-3">
        <FormNotice state={resent} />
        {needsNewCode ? (
          <SubmitButton pending={resending} pendingLabel="Sending…">
            Send a new code
          </SubmitButton>
        ) : (
          <button
            type="submit"
            disabled={resending}
            className="w-full text-center text-sm font-medium text-foreground underline underline-offset-4 hover:text-brand disabled:opacity-60"
          >
            {resending ? 'Sending…' : 'Send a new code'}
          </button>
        )}
      </form>
    </div>
  );
}
