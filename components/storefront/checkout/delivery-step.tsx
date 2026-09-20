'use client';

/*
 * Step 2 — how it gets there.
 *
 * The options are the merchant's own (Settings → Delivery), quoted by the
 * server for the address the shopper just gave: the rates of the zone that
 * covers their city or state, plus any pickup points. Checkout-view fetches
 * them and hands them here; this component only shows them and records the
 * choice. Placing the order quotes again on the server, so what's charged is
 * never a figure the browser made up.
 *
 * A radio group of cards: one choice, arrow-key navigable, one tab stop, and
 * the whole card is the label. Each option states its name, its window and
 * its price — the three things a shopper compares.
 *
 * Selecting writes straight through to the checkout store as well as the
 * form, so the order summary's delivery line and total update as the
 * shopper reads the options.
 */
import { useWatch, type UseFormReturn } from 'react-hook-form';
import { Loader2, MapPin, Store, Truck } from 'lucide-react';
import type { CheckoutFormValues } from '@/lib/storefront/checkout/schema';
import { deliveryEstimate } from '@/lib/storefront/checkout/config';
import { formatMoney } from '@/lib/storefront/format';
import type { ShippingMethod } from '@/lib/storefront/types';
import { FieldError } from '@/components/ui/form-field';
import { RadioGroup, RadioGroupCard } from '@/components/ui/radio-group';

export function DeliveryStep({
  form,
  options,
  status,
  zoneName,
  errorMessage,
  addressLabel,
  onRetry,
  onChangeAddress,
  currency,
  onSelect,
}: {
  form: UseFormReturn<CheckoutFormValues>;
  options: ShippingMethod[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** the merchant's zone that priced delivery, when one did */
  zoneName: string | null;
  errorMessage: string | null;
  /** "Port Harcourt, Rivers" — what the options were quoted for */
  addressLabel: string;
  onRetry: () => void;
  onChangeAddress: () => void;
  currency: string;
  /** mirror the choice into the checkout store so the summary re-totals */
  onSelect: (id: string) => void;
}) {
  const { control, setValue, formState } = form;
  /* useWatch, not form.watch(): with the React Compiler on (next.config.ts)
   * a watch() call is memoised away and the choice never re-renders. */
  const selected = useWatch({ control, name: 'deliveryMethodId' });
  const error = formState.errors.deliveryMethodId?.message;

  const choose = (id: string) => {
    setValue('deliveryMethodId', id, { shouldValidate: true });
    onSelect(id);
  };

  if (status === 'idle' || (status === 'loading' && options.length === 0)) {
    return (
      <p role="status" className="flex items-center gap-2 rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Finding delivery options{addressLabel ? ` for ${addressLabel}` : ''}…
      </p>
    );
  }

  if (status === 'error') {
    return (
      <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
        <p>{errorMessage ?? 'We couldn’t load delivery options just now.'}</p>
        <button type="button" onClick={onRetry} className="mt-2 font-semibold text-brand hover:underline">
          Try again
        </button>
      </div>
    );
  }

  const delivery = options.filter((o) => o.kind !== 'pickup');
  const pickups = options.filter((o) => o.kind === 'pickup');

  if (options.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-4 text-sm">
        <p className="font-semibold">This store doesn’t deliver to {addressLabel || 'this address'} yet</p>
        <p className="mt-1 text-muted-foreground">
          Check the city and state are right, or try a different delivery address.
        </p>
        <button type="button" onClick={onChangeAddress} className="mt-3 font-semibold text-brand hover:underline">
          Change address
        </button>
      </div>
    );
  }

  const card = (method: ShippingMethod) => {
    const Icon = method.kind === 'pickup' ? Store : Truck;
    const freeByThreshold = method.price === 0 && (method.regularPrice ?? 0) > 0;
    return (
      <RadioGroupCard key={method.id} value={method.id} id={`delivery-${method.id}`}>
        <span className="flex items-start justify-between gap-4">
          <span className="flex min-w-0 items-start gap-3">
            <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{method.label}</span>
              <span className="mt-0.5 block text-sm text-muted-foreground">{deliveryEstimate(method)}</span>
              {method.kind === 'pickup' && method.pickup ? (
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {method.description}
                  {method.pickup.instructions ? ` · ${method.pickup.instructions}` : ''}
                </span>
              ) : (
                method.freeOver != null &&
                !freeByThreshold && (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Free when your items come to {formatMoney(method.freeOver, currency)}
                  </span>
                )
              )}
            </span>
          </span>
          <span className="shrink-0 text-right text-sm font-semibold tabular-nums">
            {method.price === 0 ? 'Free' : formatMoney(method.price, currency)}
            {freeByThreshold && (
              <span className="block text-xs font-normal text-muted-foreground line-through">
                {formatMoney(method.regularPrice!, currency)}
              </span>
            )}
          </span>
        </span>
      </RadioGroupCard>
    );
  };

  return (
    <div>
      <p className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        <MapPin className="size-4 shrink-0" aria-hidden />
        <span>
          Options for <span className="font-medium text-foreground">{addressLabel}</span>
        </span>
        <button type="button" onClick={onChangeAddress} className="font-semibold text-brand hover:underline">
          Change
        </button>
        {status === 'loading' && <Loader2 className="size-3.5 animate-spin" aria-label="Updating" />}
      </p>

      <RadioGroup
        value={selected ?? ''}
        onValueChange={choose}
        aria-label="Delivery method"
        aria-describedby={error ? 'delivery-error' : undefined}
        aria-invalid={error ? true : undefined}
      >
        {delivery.map(card)}
        {pickups.length > 0 && delivery.length > 0 && (
          <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Or collect it</p>
        )}
        {pickups.map(card)}
      </RadioGroup>

      {delivery.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          This store doesn’t deliver to {addressLabel || 'this address'} yet, but you can collect your order.
        </p>
      )}

      {error && (
        <FieldError id="delivery-error" className="mt-3 text-sm">
          {error}
        </FieldError>
      )}

      {delivery.length > 0 && (
        <p className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <Truck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Delivery {zoneName ? `to ${zoneName} ` : ''}windows are working days from dispatch.
        </p>
      )}
    </div>
  );
}
