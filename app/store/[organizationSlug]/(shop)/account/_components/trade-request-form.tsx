'use client';

/*
 * "Ask for a trade account" (ROADMAP 21.1). The request waits for the
 * store; nothing changes for the shopper until it's approved.
 */
import { useActionState } from 'react';
import { requestTradeAccountAction, type TradeRequestState } from '@/features/shop-account/trade';
import { TextField, FieldRow, NoteField } from '@/components/storefront/checkout/checkout-fields';
import { SubmitButton } from './submit-button';
import { FormNotice } from './form-notice';

export function TradeRequestForm({ businessName = '', taxId = '' }: { businessName?: string; taxId?: string }) {
  const [state, action, pending] = useActionState<TradeRequestState, FormData>(requestTradeAccountAction, null);

  if (state?.sent) {
    return (
      <FormNotice state={{ message: 'Your request has been sent. The store will let you know by email once they’ve decided.' }} />
    );
  }

  return (
    <form action={action} className="space-y-4" noValidate>
      <FormNotice state={state} />
      <TextField
        id="trade-business"
        name="businessName"
        label="Business name"
        autoComplete="organization"
        defaultValue={state?.values?.businessName ?? businessName}
        error={state?.fieldErrors?.businessName}
        required
      />
      <FieldRow>
        <TextField
          id="trade-tin"
          name="taxId"
          label="Tax ID (TIN)"
          optional
          defaultValue={state?.values?.taxId ?? taxId}
          error={state?.fieldErrors?.taxId}
        />
        <TextField
          id="trade-cac"
          name="cacNumber"
          label="CAC number"
          optional
          placeholder="RC 1234567"
          defaultValue={state?.values?.cacNumber}
          error={state?.fieldErrors?.cacNumber}
        />
      </FieldRow>
      <NoteField
        id="trade-note"
        name="note"
        label="Anything the store should know (optional)"
        hint="For example, what you sell and where your shop is."
        maxLength={500}
        defaultValue={state?.values?.note}
        error={state?.fieldErrors?.note}
      />
      <div className="sm:max-w-[16rem]">
        <SubmitButton pending={pending} pendingLabel="Sending…">
          Ask for a wholesale account
        </SubmitButton>
      </div>
    </form>
  );
}
