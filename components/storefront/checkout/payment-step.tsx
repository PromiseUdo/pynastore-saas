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
 * Each method's `handoffNote` (lib/storefront/checkout/payment-methods.ts) —
 * what happens next — is NOT repeated under the options here: the method's
 * own one-line description says enough to choose by, and the note appears
 * once, on the Review step, where the shopper confirms the order. It is
 * written in the future tense on
 * purpose — "will be completed", "you'll get account details" — because
 * that is the truth, and the day the provider is wired in the sentence is
 * still true.
 *
 * The methods come from the tenant's checkout config, so a store that only
 * takes transfers simply has one option here. No component assumes every
 * store accepts the same things.
 *
 * WHAT'S IN THE BAG can rule a method out: a product the merchant wants paid
 * for up front takes pay on delivery off the whole order. The option stays
 * on screen, greyed out with the reason beside it — a choice that silently
 * disappears looks like a bug, and the shopper still has to understand why
 * before they can decide to pay online or drop the item. The rule itself is
 * in lib/storefront/checkout/payment-terms.ts, and the server applies the
 * same one to the order it actually writes.
 */
import { useWatch, type UseFormReturn } from 'react-hook-form';
import { Banknote, CreditCard, Landmark, Lock, Wallet } from 'lucide-react';
import { ON_ACCOUNT_METHOD_ID, accountAvailability } from '@/lib/trade/credit-rules';
import type { CheckoutConfig } from '@/lib/storefront/checkout/types';
import type { CheckoutFormValues } from '@/lib/storefront/checkout/schema';
import type { CartItem } from '@/lib/storefront/types';
import {
  isPaymentMethodAllowed,
  prepaymentReason,
  PREPAYMENT_REQUIRED_MESSAGE,
} from '@/lib/storefront/checkout/payment-terms';
import { FieldError } from '@/components/ui/form-field';
import { RadioGroup, RadioGroupCard } from '@/components/ui/radio-group';
import { OnlinePaymentLogos } from '@/components/storefront/payment/payment-badges';

/* Icons are decoration on top of the label, never the only signal. */
const ICONS: Record<string, typeof CreditCard> = {
  paystack: CreditCard,
  card: CreditCard,
  transfer: Landmark,
  pod: Banknote,
  account: Wallet,
};

export function PaymentStep({
  form,
  config,
  items,
  orderTotal = 0,
  onSelect,
}: {
  form: UseFormReturn<CheckoutFormValues>;
  config: CheckoutConfig;
  /** the bag, because a line's payment terms decide what may be offered */
  items: CartItem[];
  /** minor units: pay on account must fit the buyer's credit (ROADMAP 21.5) */
  orderTotal?: number;
  onSelect: (id: string) => void;
}) {
  const { control, setValue, formState } = form;
  /* useWatch, not form.watch(): with the React Compiler on (next.config.ts)
   * a watch() call is memoised away and the choice never re-renders. */
  const selectedId = useWatch({ control, name: 'paymentMethodId' });
  const error = formState.errors.paymentMethodId?.message;
  const reason = prepaymentReason(items);

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
          const termsAllow = isPaymentMethodAllowed(method, items);
          // Pay on account (21.5): nothing overdue, and within the credit left — the server's own rule.
          const credit =
            method.id === ON_ACCOUNT_METHOD_ID && config.tradeAccount
              ? accountAvailability(config.tradeAccount, orderTotal, config.currency)
              : ({ ok: true } as const);
          const allowed = termsAllow && credit.ok;
          return (
            <RadioGroupCard
              key={method.id}
              value={method.id}
              id={`payment-${method.id}`}
              disabled={!allowed}
            >
              <span className="flex items-start gap-3">
                {Icon && <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{method.label}</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">
                    {allowed ? method.description : 'Not available for this order'}
                  </span>
                  {/* Who takes the payment and the cards they accept — online only. */}
                  {method.provider === 'paystack' && allowed && <OnlinePaymentLogos className="mt-2" />}
                  {!allowed && (
                    <span className="mt-2 flex items-start gap-2 text-sm text-foreground">
                      <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                      {!credit.ok ? (
                        <span>{credit.reason}</span>
                      ) : (
                        <span>
                          {method.id === ON_ACCOUNT_METHOD_ID
                            ? 'Pay on account isn’t available because one or more items in your order must be paid for before delivery.'
                            : PREPAYMENT_REQUIRED_MESSAGE}
                          {reason && <span className="mt-1 block text-muted-foreground">{reason}</span>}
                        </span>
                      )}
                    </span>
                  )}
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
    </div>
  );
}
