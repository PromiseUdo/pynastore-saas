'use client';

/*
 * Create an account: name, email, phone, password.
 *
 * Phone is asked for here because every account comes with a wallet, and
 * the wallet needs one (ROADMAP 20.2). The address is still NOT: checkout
 * collects it when it is actually needed, and saves it then.
 */
import { useActionState } from 'react';
import { registerAction, type AccountFormState } from '@/features/shop-account/actions';
import { TextField } from '@/components/storefront/checkout/checkout-fields';
import { PasswordField } from './password-field';
import { SubmitButton } from './submit-button';
import { AuthError } from './auth-shell';

/** `walletNotice`: wallets are switched on, so say what is shared with EduPay (ROADMAP 20.2). */
export function RegisterForm({ next, walletNotice = false }: { next: string; walletNotice?: boolean }) {
  const [state, action, pending] = useActionState<AccountFormState, FormData>(registerAction, null);

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />

      {state?.error && <AuthError>{state.error}</AuthError>}

      <TextField
        id="sf-name"
        name="name"
        label="Full name"
        autoComplete="name"
        placeholder="Ada Okafor"
        defaultValue={state?.values?.name}
        error={state?.fieldErrors?.name}
        required
      />

      <TextField
        id="sf-email"
        name="email"
        label="Email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="you@example.com"
        defaultValue={state?.values?.email}
        error={state?.fieldErrors?.email}
        hint="We'll send order updates here."
        required
      />

      <TextField
        id="sf-phone"
        name="phone"
        label="Phone number"
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        placeholder="0803 123 4567"
        defaultValue={state?.values?.phone}
        error={state?.fieldErrors?.phone}
        required
      />

      <PasswordField
        id="sf-password"
        name="password"
        label="Password"
        autoComplete="new-password"
        hint="At least 8 characters."
        error={state?.fieldErrors?.password}
        required
      />

      <SubmitButton pending={pending} pendingLabel="Creating your account…">
        Create account
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
