'use client';

/*
 * "Deliver to Port Harcourt · Ships from Lagos Store · ₦4,500" on the product
 * page (ROADMAP Phase 9.8).
 *
 * The place is the one this shopper chose in this browser, or — signed in
 * and nothing chosen — their default address. The estimate is checkout's own
 * planner run for one of this variant (features/shop-orders/actions.ts →
 * lib/storefront/delivery/estimate.ts), so it names the store the item would
 * really leave from and the price that store charges for the trip. It stays
 * an estimate: the whole bag and the exact address decide at checkout, and
 * the panel says so.
 */
import { NeighbourhoodField, useNeighbourhoods } from '@/components/storefront/checkout/neighbourhoods';
import { findLga, lgaOptions } from '@/lib/geo/nigeria-lgas';
import * as React from 'react';
import { Loader2, MapPin, Truck } from 'lucide-react';
import { NIGERIAN_STATES } from '@/lib/geo/nigeria';
import { SelectField } from '@/components/storefront/checkout/checkout-fields';
import { formatMoney } from '@/lib/storefront/format';
import { formatEta } from '@/lib/storefront/delivery/eta';
import { useShopper } from '@/lib/storefront/context';
import { useDeliverToStore } from '@/lib/storefront/stores/deliver-to-store';
import { estimateDeliveryAction, type EstimateDeliveryResult } from '@/features/shop-orders/actions';
import type { DeliverySummary } from '@/lib/storefront/store-claims';

const STATE_OPTIONS = NIGERIAN_STATES.map((s) => ({ value: s, label: s }));

type Loaded = Extract<EstimateDeliveryResult, { ok: true }>;

export function DeliverToEstimate({
  productId,
  variantId,
  currency,
  summary,
}: {
  productId: string;
  /** the variant chosen — or, until the picker is complete, one that's in stock */
  variantId: string | null;
  currency: string;
  /** what delivery costs somewhere, for before the shopper has said where */
  summary: DeliverySummary;
}) {
  const shopper = useShopper();
  const place = useDeliverToStore((s) => s.place);
  const hydrated = useDeliverToStore((s) => s.hydrated);
  const choose = useDeliverToStore((s) => s.choose);

  const [state, setState] = React.useState<{ status: 'idle' | 'loading' | 'ready' | 'error'; data: Loaded | null }>({
    status: 'idle',
    data: null,
  });
  const [editing, setEditing] = React.useState(false);
  const attempt = React.useRef(0);

  const placeKey = place ? `${place.state}|${place.city}|${place.area ?? ''}` : '';
  React.useEffect(() => {
    // Nothing to estimate for: no variant, or a guest who hasn't said where.
    if (!hydrated || !variantId || (!place && !shopper)) return;
    const mine = ++attempt.current;
    setState((s) => ({ ...s, status: 'loading' }));
    void estimateDeliveryAction({ productId, variantId, deliverTo: place }).then(
      (result) => {
        if (mine !== attempt.current) return; // an older answer for another variant or place
        setState(result.ok ? { status: 'ready', data: result } : { status: 'error', data: null });
      },
      () => mine === attempt.current && setState({ status: 'error', data: null }),
    );
    // placeKey stands in for `place`, so a re-created object doesn't re-ask.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, productId, variantId, placeKey, shopper]);

  if (!hydrated || !variantId) return null;

  const deliverTo = state.data?.deliverTo ?? (place ? { ...place, fromAccount: false } : null);
  const where = deliverTo ? [deliverTo.area, deliverTo.city, deliverTo.state].filter(Boolean).join(', ') : null;
  const result = state.data?.result ?? null;

  return (
    <section aria-labelledby="deliver-to-heading" className="mt-8 rounded-2xl border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="deliver-to-heading" className="flex items-center gap-2 text-sm font-semibold">
          <MapPin aria-hidden className="size-4 text-teal" />
          {where ? (
            <span>
              Deliver to {where}
              {deliverTo?.fromAccount && <span className="font-normal text-muted-foreground"> (your default address)</span>}
            </span>
          ) : (
            'Where should we deliver?'
          )}
        </h2>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-sm font-semibold text-foreground underline underline-offset-4"
          >
            {where ? 'Change' : 'Choose a location'}
          </button>
        )}
      </div>

      {/* Nowhere chosen yet: one honest line, not every store's price list. */}
      {!where && !editing && (
        <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
          <Truck aria-hidden className="mt-0.5 size-4 shrink-0 text-teal" />
          <span>
            {summary.nationwide ? 'Delivery across Nigeria' : 'Delivery to selected areas'}
            {summary.free ? ' — free to some places' : `, from ${formatMoney(summary.from, currency)}`}. Choose a location
            to see your price and which store it ships from.
          </span>
        </p>
      )}

      {editing && (
        <PlaceForm
          initial={deliverTo}
          onCancel={() => setEditing(false)}
          onSave={(next) => {
            choose(next);
            setEditing(false);
          }}
        />
      )}

      {!editing && where && (
        <div className="mt-3 text-sm" aria-live="polite">
          {state.status === 'loading' && !result ? (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 aria-hidden className="size-4 animate-spin" />
              Working out delivery…
            </p>
          ) : state.status === 'error' ? (
            <p className="text-muted-foreground">We couldn’t work out delivery just now — you’ll see it at checkout.</p>
          ) : result?.ok ? (
            <>
              <p className="flex items-start gap-2">
                <Truck aria-hidden className="mt-0.5 size-4 shrink-0 text-teal" />
                <span>
                  <span className="font-medium">Ships from {result.estimate.storeName}</span>
                  <span className="block text-muted-foreground">
                    {result.estimate.cheapest.label} ·{' '}
                    <span className="font-semibold text-foreground tabular-nums">
                      {result.estimate.cheapest.price === 0 ? 'Free' : formatMoney(result.estimate.cheapest.price, currency)}
                    </span>{' '}
                    · {formatEta(result.estimate.cheapest.eta)}
                  </span>
                  {(result.estimate.moreOptions || result.estimate.pickupCount > 0) && (
                    <span className="block text-xs text-muted-foreground">
                      {result.estimate.moreOptions ? 'More delivery options at checkout' : ''}
                      {result.estimate.moreOptions && result.estimate.pickupCount > 0 ? ' · ' : ''}
                      {result.estimate.pickupCount > 0 ? 'or collect it from our store' : ''}
                    </span>
                  )}
                  {result.estimate.arrangedForLargeOrders && (
                    // Delivery to be arranged (ROADMAP 21.4B): no number for a truck we haven't priced.
                    <span className="block text-xs text-muted-foreground">Large trade orders: delivery arranged by the store</span>
                  )}
                </span>
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                For one of this item. Your exact options and price are confirmed at checkout.
              </p>
            </>
          ) : result ? (
            <p className="text-muted-foreground">
              {result.reason === 'no-delivery'
                ? `This store doesn’t deliver to ${where} yet.`
                : result.reason === 'pickup-only'
                  ? `No delivery to ${where}, but you can collect it from our store.`
                  : result.reason === 'not-in-stock-here'
                    ? `This isn’t held anywhere we can send to ${where} right now.`
                    : 'This option isn’t available right now.'}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

function PlaceForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: { state: string; city: string; area?: string | null } | null;
  onSave: (place: { state: string; city: string; area?: string }) => void;
  onCancel: () => void;
}) {
  const [state, setState] = React.useState(initial?.state ?? '');
  // The LGA, from the official list (ROADMAP 25.1); an older "Lekki" reads as its LGA.
  const [city, setCity] = React.useState(initial ? (findLga(initial.state, initial.city) ?? initial.city) : '');
  const [error, setError] = React.useState<string | null>(null);
  // A shop that prices by neighbourhood inside this LGA asks which (ROADMAP 25.2).
  const { areas: neighbourhoods } = useNeighbourhoods(state, city);
  const [area, setArea] = React.useState(initial?.area ?? '');
  const chosenArea = neighbourhoods.includes(area) ? area : '';

  return (
    <form
      className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        if (!state) {
          setError('Choose a state.');
          return;
        }
        onSave({ state, city, ...(chosenArea ? { area: chosenArea } : {}) });
      }}
      noValidate
    >
      <SelectField
        id="deliver-to-state"
        label="State"
        placeholder="Choose a state"
        options={STATE_OPTIONS}
        searchNoun="states"
        value={state}
        onChange={(e) => {
          if (e.target.value !== state) setCity('');
          setState(e.target.value);
          setError(null);
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'deliver-to-error' : undefined}
        className="h-10 rounded-lg px-3 text-sm"
      />
      <SelectField
        id="deliver-to-city"
        label="LGA"
        placeholder={state ? 'Choose your LGA' : 'Choose a state first'}
        options={lgaOptions(state)}
        searchNoun="LGAs"
        disabled={!state}
        value={city}
        onChange={(e) => {
          setCity(e.target.value);
          setArea('');
        }}
        className="h-10 rounded-lg px-3 text-sm"
      />
      {neighbourhoods.length > 0 && (
        <div className="sm:col-span-2">
          <NeighbourhoodField
            id="deliver-to-area"
            lga={city}
            areas={neighbourhoods}
            value={chosenArea}
            onChange={(e) => setArea(e.target.value)}
            className="h-10 rounded-lg px-3 text-sm"
          />
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          className="h-10 rounded-[var(--sf-radius-button,999px)] bg-foreground px-4 text-sm font-semibold text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-10 rounded-[var(--sf-radius-button,999px)] border px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Cancel
        </button>
      </div>
      {error && (
        <p id="deliver-to-error" role="alert" className="text-sm text-destructive sm:col-span-3">
          {error}
        </p>
      )}
    </form>
  );
}
