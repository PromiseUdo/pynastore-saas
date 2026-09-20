'use client';

/*
 * Step 3 — how you'd like to pay.
 *
 * NOTHING IS CHARGED HERE, AND NOTHING IS COLLECTED HERE.
 *
 * This step records an INTENTION. There is no card form — no number, no
 * expiry, no CVV — anywhere in the storefront, and there never should be at
 * this layer: card details belong on the payment provider's own page, which
 * is where the shopper is sent after the order exists. A convincing-looking
 * card form that put a PAN into React state would be the single most
 * dangerous thing this phase could ship, so the card option says plainly
 * what happens next instead.
 *
 * Each method's `handoffNote` (lib/storefront/mock/checkout.ts) is the
 * sentence shown once it's picked. It is written in the future tense on
 * purpose — "will be completed", "you'll get account details" — because
 * that is the truth, and the day the provider is wired in the sentence is
 * still true.
 *
 * The methods come from the tenant's checkout config, so a store that only
 * takes transfers simply has one option here. No component assumes every
 * store accepts the same things.
 */
import { useWatch, type UseFormReturn } from 'react-hook-form';
import { Banknote, CreditCard, Landmark, ShieldCheck } from 'lucide-react';
import type { CheckoutConfig } from '@/lib/storefront/checkout/types';
import type { CheckoutFormValues } from '@/lib/storefront/checkout/schema';
import { findPaymentMethod } from '@/lib/storefront/checkout/config';
import { FieldError } from '@/components/ui/form-field';
import { RadioGroup, RadioGroupCard } from '@/components/ui/radio-group';

/* Icons are decoration on top of the label, never the only signal. */
const ICONS: Record<string, typeof CreditCard> = {
  squad: CreditCard,
  card: CreditCard,
  transfer: Landmark,
  pod: Banknote,
};

export function PaymentStep({
  form,
  config,
  onSelect,
}: {
  form: UseFormReturn<CheckoutFormValues>;
  config: CheckoutConfig;
  onSelect: (id: string) => void;
}) {
  const { control, setValue, formState } = form;
  /* useWatch, not form.watch(): with the React Compiler on (next.config.ts)
   * a watch() call is memoised away and the choice never re-renders. */
  const selectedId = useWatch({ control, name: 'paymentMethodId' });
  const error = formState.errors.paymentMethodId?.message;
  const selected = findPaymentMethod(config, selectedId ?? null);

  const choose = (id: string) => {
    setValue('paymentMethodId', id, { shouldValidate: true });
    onSelect(id);
  };

  return (
    <div>
      <RadioGroup
        value={selectedId ?? ''}
        onValueChange={choose}
        aria-label="Payment method"
        aria-describedby={error ? 'payment-error' : undefined}
        aria-invalid={error ? true : undefined}
      >
        {config.paymentMethods.map((method) => {
          const Icon = ICONS[method.id];
          return (
            <RadioGroupCard key={method.id} value={method.id} id={`payment-${method.id}`}>
              <span className="flex items-start gap-3">
                {Icon && <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{method.label}</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">
                    {method.description}
                  </span>
                </span>
              </span>
            </RadioGroupCard>
          );
        })}
      </RadioGroup>

      {error && (
        <FieldError id="payment-error" className="mt-3 text-sm">
          {error}
        </FieldError>
      )}

      {/* The honest sentence, in place of a fake card form. */}
      {selected && (
        <p
          role="status"
          className="mt-5 flex items-start gap-2.5 rounded-xl border bg-secondary/40 p-4 text-sm leading-relaxed text-muted-foreground"
        >
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          <span>{selected.handoffNote}</span>
        </p>
      )}
    </div>
  );
}
