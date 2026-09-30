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
import type { CartItem, ShippingMethod } from '@/lib/storefront/types';
import { parcelChoiceId, parcelChoices, type ParcelOffer } from '@/lib/storefront/delivery/plan';
import { FieldError } from '@/components/ui/form-field';
import { RadioGroup, RadioGroupCard } from '@/components/ui/radio-group';

export function DeliveryStep({
  form,
  options,
  parcels = [],
  items = [],
  status,
  zoneName,
  notice,
  errorMessage,
  addressLabel,
  onRetry,
  onChangeAddress,
  currency,
  onSelect,
}: {
  form: UseFormReturn<CheckoutFormValues>;
  options: ShippingMethod[];
  /** a bag split across stores: each parcel chosen on its own (ROADMAP Phase 9.5) */
  parcels?: ParcelOffer[];
  /** the bag, to name what's in each parcel */
  items?: CartItem[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** the merchant's zone that priced delivery, when one did */
  zoneName: string | null;
  /** why there's no delivery when it's the bag, not the address (Phase 9.3) */
  notice?: string | null;
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
  const multi = parcels.length > 1;

  if (options.length === 0 && !multi) {
    return (
      <div className="rounded-xl border bg-card p-4 text-sm">
        {notice ? (
          <p className="font-semibold">{notice}</p>
        ) : (
          <>
            <p className="font-semibold">This store doesn’t deliver to {addressLabel || 'this address'} yet</p>
            <p className="mt-1 text-muted-foreground">
              Check the city and state are right, or try a different delivery address.
            </p>
          </>
        )}
        <button type="button" onClick={onChangeAddress} className="mt-3 font-semibold text-brand hover:underline">
          Change address
        </button>
      </div>
    );
  }

  const card = (method: ShippingMethod, idPrefix = '') => {
    const Icon = method.kind === 'pickup' ? Store : Truck;
    const freeByThreshold = method.price === 0 && (method.regularPrice ?? 0) > 0;
    return (
      <RadioGroupCard key={method.id} value={method.id} id={`delivery-${idPrefix}${method.id}`}>
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
              ) : method.consolidatedFrom?.length ? (
                /* Brought together at one store first (Phase 9.7): say why it
                 * takes longer and costs a little more. */
                <span className="mt-0.5 block text-xs text-muted-foreground">{method.description}</span>
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

  const addressBar = (
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
  );

  /* ---- a bag in several parcels: each store sends its part, chosen on its own ---- */
  if (multi) {
    const chosen = parcelChoices(parcels, selected ?? '');
    const names = new Map(items.map((item) => [item.variantId, item.name]));
    const chooseForParcel = (index: number, optionId: string) => {
      const ids = chosen ? chosen.map((m) => m.id) : parcels.map((p) => p.options[0].id);
      ids[index] = optionId;
      choose(parcelChoiceId(ids));
    };

    return (
      <div>
        {addressBar}
        <p className="mb-4 text-sm text-muted-foreground">
          Your order comes in {parcels.length} parcels — each store sends what it has. Choose how each one travels;
          delivery is what they add up to.
        </p>

        <div className="space-y-4">
          {parcels.map((parcel, index) => {
            const headingId = `parcel-${index}-heading`;
            return (
              <section key={parcel.storeName + index} aria-labelledby={headingId} className="rounded-xl border bg-card p-4">
                <h3 id={headingId} className="text-sm font-semibold">
                  Parcel {index + 1} of {parcels.length} · From {parcel.storeName}
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {parcel.lines
                    .map((line) => `${names.get(line.itemId) ?? 'Item'}${line.quantity > 1 ? ` × ${line.quantity}` : ''}`)
                    .join(', ')}
                </p>
                <RadioGroup
                  className="mt-3"
                  value={chosen?.[index]?.id ?? ''}
                  onValueChange={(id) => chooseForParcel(index, id)}
                  aria-labelledby={headingId}
                >
                  {parcel.options.map((method) => card(method, `p${index}-`))}
                </RadioGroup>
              </section>
            );
          })}
        </div>

        {pickups.length > 0 && (
          <div className="mt-5">
            <p className="pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Or collect everything from one store
            </p>
            <RadioGroup value={selected ?? ''} onValueChange={choose} aria-label="Collect instead">
              {pickups.map((method) => card(method))}
            </RadioGroup>
          </div>
        )}

        {error && (
          <FieldError id="delivery-error" className="mt-3 text-sm">
            {error}
          </FieldError>
        )}

        <p className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <Truck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Parcels may arrive on different days. Delivery windows run from dispatch
          {parcels.some((p) => p.options.some((m) => m.eta.unit === 'DAYS')) ? ', and windows in days are working days' : ''}.
        </p>
      </div>
    );
  }

  return (
    <div>
      {addressBar}

      <RadioGroup
        value={selected ?? ''}
        onValueChange={choose}
        aria-label="Delivery method"
        aria-describedby={error ? 'delivery-error' : undefined}
        aria-invalid={error ? true : undefined}
      >
        {delivery.map((method) => card(method))}
        {pickups.length > 0 && delivery.length > 0 && (
          <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Or collect it</p>
        )}
        {pickups.map((method) => card(method))}
      </RadioGroup>

      {delivery.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          {notice
            ? 'We can’t send everything in your bag to this address, but you can collect your order.'
            : `This store doesn’t deliver to ${addressLabel || 'this address'} yet, but you can collect your order.`}
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
          Delivery {zoneName ? `to ${zoneName} ` : ''}windows run from dispatch
          {delivery.some((m) => m.eta.unit === 'DAYS') ? ', and windows in days are working days' : ''}.
        </p>
      )}
    </div>
  );
}
