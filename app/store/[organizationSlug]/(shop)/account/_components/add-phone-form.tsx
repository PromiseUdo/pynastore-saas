'use client';

/* The one field on /account/phone. Saving goes on to where they were heading. */
import { useActionState } from 'react';
import { addPhoneAction, type ProfileFormState } from '@/features/shop-account/profile-actions';
import { TextField } from '@/components/storefront/checkout/checkout-fields';
import { SubmitButton } from './submit-button';
import { AuthError } from './auth-shell';

/** `walletNotice`: wallets are switched on, so say what is shared with EduPay (ROADMAP 20.2). */
export function AddPhoneForm({ next, walletNotice = false }: { next: string; walletNotice?: boolean }) {
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

      {walletNotice && (
        <p className="text-center text-xs text-muted-foreground">
          Your account includes a wallet provided by EduPay. We share your name, email and phone number with EduPay to
          set it up.
        </p>
      )}
    </form>
  );
}
