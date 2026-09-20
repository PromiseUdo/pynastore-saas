'use client';

/*
 * The press that spends an email-change link.
 *
 * On success the card is replaced by the outcome rather than redirecting:
 * the person may not be signed in on this device (a link opened on a phone),
 * so "it worked, here's what to do next" is more use than a bounce to a page
 * that would only ask them to sign in with an address they've just changed.
 */
import { useActionState } from 'react';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import {
  confirmEmailChangeAction,
  type ProfileFormState,
} from '@/features/shop-account/profile-actions';
import { SubmitButton } from './submit-button';
import { AuthError } from './auth-shell';

export function ConfirmEmailForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<ProfileFormState, FormData>(
    confirmEmailChangeAction,
    null,
  );

  if (state?.message) {
    return (
      <div className="space-y-4 text-center">
        <CheckCircle2 className="mx-auto size-7 text-brand" aria-hidden />
        <p role="status" className="text-sm">
          Done — your account now uses{' '}
          <span className="break-all font-medium">{state.message}</span>. Anywhere else you were
          signed in has been signed out.
        </p>
        <Link
          href="/account"
          className="inline-flex h-12 items-center rounded-full bg-brand px-6 text-base font-semibold text-primary-foreground transition-colors hover:bg-brand-hover"
        >
          Go to your account
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />

      {state?.error && (
        <>
          <AuthError>{state.error}</AuthError>
          <Link
            href="/account/profile"
            className="block text-center text-sm font-medium text-foreground underline underline-offset-4 hover:text-brand"
          >
            Back to your profile
          </Link>
        </>
      )}

      {!state?.error && (
        <SubmitButton pending={pending} pendingLabel="Confirming…">
          Confirm this email
        </SubmitButton>
      )}
    </form>
  );
}
