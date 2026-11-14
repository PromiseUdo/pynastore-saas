'use client';

/* The one field on /account/phone. Saving goes on to where they were heading. */
import { useActionState } from 'react';
import { addPhoneAction, type ProfileFormState } from '@/features/shop-account/profile-actions';
import { TextField } from '@/components/storefront/checkout/checkout-fields';
import { SubmitButton } from './submit-button';
import { AuthError } from './auth-shell';

export function AddPhoneForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<ProfileFormState, FormData>(addPhoneAction, null);

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />
      {state?.error && <AuthError>{state.error}</AuthError>}
      <TextField
        id="sf-add-phone"
        name="phone"
        label="Phone number"
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        placeholder="0803 123 4567"
        defaultValue={state?.values?.phone}
        error={state?.fieldErrors?.phone}
        required
        autoFocus
      />
      <SubmitButton pending={pending} pendingLabel="Saving…">
        Save and continue
      </SubmitButton>

    </form>
  );
}
