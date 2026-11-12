'use client';

/*
 * Name and phone. The two fields checkout will pre-fill from (Part 3), which
 * is the whole reason they're worth keeping up to date.
 */
import { useActionState } from 'react';
import { updateProfileAction, type ProfileFormState } from '@/features/shop-account/profile-actions';
import { TextField, FieldRow } from '@/components/storefront/checkout/checkout-fields';
import { formatNigerianPhone } from '@/lib/phone';
import { SubmitButton } from './submit-button';
import { FormNotice } from './form-notice';

export function ProfileDetailsForm({ name, phone }: { name: string; phone: string }) {
  const [state, action, pending] = useActionState<ProfileFormState, FormData>(
    updateProfileAction,
    null,
  );

  return (
    <form action={action} className="space-y-4" noValidate>
      <FormNotice state={state} />

      <FieldRow>
        <TextField
          id="profile-name"
          name="name"
          label="Full name"
          autoComplete="name"
          defaultValue={state?.values?.name ?? name}
          error={state?.fieldErrors?.name}
          required
        />
        <TextField
          id="profile-phone"
          name="phone"
          label="Phone number"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="0803 123 4567"
          defaultValue={state?.values?.phone ?? formatNigerianPhone(phone)}
          error={state?.fieldErrors?.phone}
          required
        />
      </FieldRow>

      <div className="sm:max-w-[13rem]">
        <SubmitButton pending={pending} pendingLabel="Saving…">
          Save details
        </SubmitButton>
      </div>
    </form>
  );
}
