'use client';

/*
 * The shopper's wallet PIN (ROADMAP 20.3): create it, or change it.
 *
 * The PIN approves payments from the wallet, so the fields are masked, never
 * autofilled, and never sent back in an error. Forgetting it can't be fixed
 * here yet (EduPay has no reset), and the card says so rather than hiding it.
 */
import { useActionState } from 'react';
import {
  changeShopperPinAction,
  createShopperPinAction,
  type WalletPinFormState,
} from '@/features/shop-account/wallet-actions';
import { TextField } from '@/components/storefront/checkout/checkout-fields';
import { SubmitButton } from './submit-button';
import { FormNotice } from './form-notice';

const PIN_INPUT = {
  type: 'password',
  inputMode: 'numeric',
  pattern: '[0-9]*',
  maxLength: 4,
  autoComplete: 'off',
  className: 'tracking-[0.5em] tabular-nums',
  required: true,
} as const;

export function CreatePinForm() {
  const [state, action, pending] = useActionState<WalletPinFormState, FormData>(createShopperPinAction, null);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormNotice state={state} />
      <TextField id="wallet-pin" name="pin" label="New PIN" error={state?.fieldErrors?.pin} {...PIN_INPUT} />
      <TextField id="wallet-pin-confirm" name="confirmPin" label="Type it again" error={state?.fieldErrors?.confirmPin} {...PIN_INPUT} />
      <SubmitButton pending={pending} pendingLabel="Saving…">
        Create PIN
      </SubmitButton>
    </form>
  );
}

export function ChangePinForm() {
  const [state, action, pending] = useActionState<WalletPinFormState, FormData>(changeShopperPinAction, null);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormNotice state={state} />
      <TextField id="wallet-pin-current" name="currentPin" label="Current PIN" error={state?.fieldErrors?.currentPin} {...PIN_INPUT} />
      <TextField id="wallet-pin-new" name="pin" label="New PIN" error={state?.fieldErrors?.pin} {...PIN_INPUT} />
      <TextField id="wallet-pin-new-confirm" name="confirmPin" label="Type the new PIN again" error={state?.fieldErrors?.confirmPin} {...PIN_INPUT} />
      <SubmitButton pending={pending} pendingLabel="Saving…">
        Change PIN
      </SubmitButton>
    </form>
  );
}
