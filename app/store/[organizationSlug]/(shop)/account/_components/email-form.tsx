'use client';

/*
 * Changing the address the account signs in with.
 *
 * Asking for the password here is not ceremony: this field decides who can
 * recover the account tomorrow, and an unattended, already-signed-in browser
 * should not be able to move it. The server enforces it too — this is only
 * where we explain it.
 *
 * Submitting does NOT change the address: it asks for one, and the shopper
 * confirms from the new inbox. The card says so plainly both before (the
 * button is "Send confirmation link") and after (the pending banner), so
 * nobody walks away believing a change has happened that hasn't.
 *
 * For a Google-only account there is nothing to edit, so the address is
 * shown as a fact with the reason beside it rather than as a disabled box
 * nobody can explain.
 */
import { useActionState, useState } from 'react';
import { BadgeCheck, Clock } from 'lucide-react';
import {
  requestEmailChangeAction,
  type ProfileFormState,
} from '@/features/shop-account/profile-actions';
import { TextField } from '@/components/storefront/checkout/checkout-fields';
import { PasswordField } from './password-field';
import { SubmitButton } from './submit-button';
import { FormNotice } from './form-notice';

export function EmailForm({
  email,
  verified,
  editable,
  pendingEmail,
}: {
  email: string;
  verified: boolean;
  editable: boolean;
  /** an address already asked for, still waiting on its confirmation link */
  pendingEmail: string | null;
}) {
  const [state, action, pending] = useActionState<ProfileFormState, FormData>(
    requestEmailChangeAction,
    null,
  );
  const [open, setOpen] = useState(false);

  if (!editable) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="break-all text-sm">{email}</span>
        <VerifiedMark verified={verified} />
      </div>
    );
  }

  if (!open && !state?.error && !state?.fieldErrors) {
    return (
      <div className="space-y-3">
        <FormNotice state={state} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="break-all text-sm">{email}</span>
          <VerifiedMark verified={verified} />
        </div>

        {pendingEmail && !state?.message && (
          <p className="flex items-start gap-2 rounded-xl border border-border bg-secondary/60 px-4 py-3 text-sm">
            <Clock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span>
              Waiting for <span className="break-all font-medium">{pendingEmail}</span> to be
              confirmed. Until then, you still sign in with the address above.
            </span>
          </p>
        )}

        <button
          type="button"
          onClick={() => setOpen(true)}
          className="h-11 rounded-full border border-border bg-card px-5 text-sm font-medium transition-colors hover:border-brand hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {pendingEmail ? 'Use a different email' : 'Change email'}
        </button>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4" noValidate>
      <FormNotice state={state} />

      <TextField
        id="profile-email"
        name="email"
        label="New email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        hint="We'll send a link there to confirm it's yours."
        defaultValue={state?.values?.email ?? ''}
        error={state?.fieldErrors?.email}
        required
      />

      <PasswordField
        id="profile-email-password"
        name="currentPassword"
        label="Your password"
        autoComplete="current-password"
        hint="To confirm it's you."
        error={state?.fieldErrors?.currentPassword}
        required
      />

      <div className="flex flex-wrap gap-3">
        <div className="min-w-[11rem] flex-1 sm:max-w-[13rem]">
          <SubmitButton pending={pending} pendingLabel="Sending…">
            Send confirmation link
          </SubmitButton>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="h-12 rounded-full px-5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function VerifiedMark({ verified }: { verified: boolean }) {
  if (!verified) {
    return <span className="text-xs text-muted-foreground">Not confirmed yet</span>;
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <BadgeCheck className="size-3.5 text-brand" aria-hidden />
      Confirmed
    </span>
  );
}
