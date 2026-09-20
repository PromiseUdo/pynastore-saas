'use client';

/*
 * The address form, used for both adding and editing — one form, because
 * "add" and "edit" differ only in whether an id rides along and what the
 * button says. Two near-identical forms is how the two slowly diverge.
 *
 * The country and region lists come from the store's checkout config, so an
 * address saved here is one checkout will accept. The form relabels itself
 * from that same data ("State" vs "County"), and only asks for a postcode
 * where the country actually needs one — no component branches on a country
 * code.
 */
import * as React from 'react';
import { useActionState } from 'react';
import Link from 'next/link';
import { saveAddressAction, type AddressFormState } from '@/features/shop-account/address-actions';
import type { Address } from '@/lib/storefront/types';
import type { CheckoutConfig } from '@/lib/storefront/checkout/types';
import { findCountry } from '@/lib/storefront/checkout/config';
import { TextField, SelectField, FieldRow } from '@/components/storefront/checkout/checkout-fields';
import { SubmitButton } from './submit-button';
import { FormNotice } from './form-notice';

export function AddressForm({
  config,
  address,
  isOnlyAddress,
}: {
  config: CheckoutConfig;
  /** absent when adding */
  address?: Address;
  /** the first address is the default whatever the box says, so don't offer it */
  isOnlyAddress: boolean;
}) {
  const [state, action, pending] = useActionState<AddressFormState, FormData>(
    saveAddressAction,
    null,
  );

  const initialCountry =
    config.countries.find((c) => c.name === address?.country || c.code === address?.country)?.code ??
    config.defaultCountryCode;

  const [countryCode, setCountryCode] = React.useState(state?.values?.country ?? initialCountry);
  const country = findCountry(config, countryCode);

  const value = (field: keyof Address, fallback = '') =>
    state?.values?.[field] ?? (address?.[field] as string | undefined) ?? fallback;

  return (
    <form action={action} className="space-y-4" noValidate>
      {address && <input type="hidden" name="id" value={address.id} />}

      <FormNotice state={state} />

      <TextField
        id="address-full-name"
        name="fullName"
        label="Full name"
        autoComplete="name"
        hint="Who should the courier ask for?"
        defaultValue={value('fullName')}
        error={state?.fieldErrors?.fullName}
        required
      />

      <TextField
        id="address-phone"
        name="phone"
        label="Phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder={country?.phonePrefix ? `${country.phonePrefix} 801 234 5678` : undefined}
        hint="So the courier can call on the day."
        defaultValue={value('phone')}
        error={state?.fieldErrors?.phone}
        required
      />

      <SelectField
        id="address-country"
        name="country"
        label="Country"
        options={config.countries.map((c) => ({ value: c.code, label: c.name }))}
        value={countryCode}
        onChange={(e) => setCountryCode(e.target.value)}
        error={state?.fieldErrors?.country}
      />

      <TextField
        id="address-line1"
        name="line1"
        label="Street address"
        autoComplete="address-line1"
        placeholder="House number and street"
        defaultValue={value('line1')}
        error={state?.fieldErrors?.line1}
        required
      />

      <TextField
        id="address-line2"
        name="line2"
        label="Apartment, suite, landmark"
        autoComplete="address-line2"
        optional
        defaultValue={value('line2')}
        error={state?.fieldErrors?.line2}
      />

      <FieldRow>
        {country && country.regions.length > 0 ? (
          <SelectField
            id="address-state"
            name="state"
            label={country.regionLabel}
            placeholder={`Choose a ${country.regionLabel.toLowerCase()}`}
            options={country.regions.map((r) => ({ value: r, label: r }))}
            defaultValue={value('state')}
            error={state?.fieldErrors?.state}
          />
        ) : (
          <TextField
            id="address-state"
            name="state"
            label={country?.regionLabel ?? 'State or region'}
            autoComplete="address-level1"
            defaultValue={value('state')}
            error={state?.fieldErrors?.state}
            required
          />
        )}

        <TextField
          id="address-city"
          name="city"
          label="City or town"
          autoComplete="address-level2"
          defaultValue={value('city')}
          error={state?.fieldErrors?.city}
          required
        />
      </FieldRow>

      {country?.postalCodeRequired ? (
        <TextField
          id="address-postal-code"
          name="postalCode"
          label={country.postalCodeLabel}
          autoComplete="postal-code"
          defaultValue={value('postalCode')}
          error={state?.fieldErrors?.postalCode}
          required
        />
      ) : (
        <TextField
          id="address-postal-code"
          name="postalCode"
          label={country?.postalCodeLabel ?? 'Postcode'}
          autoComplete="postal-code"
          optional
          defaultValue={value('postalCode')}
          error={state?.fieldErrors?.postalCode}
        />
      )}

      {!isOnlyAddress && !address?.isDefault && (
        <label className="flex items-start gap-3 rounded-xl border border-border bg-secondary/40 px-4 py-3.5">
          <input
            type="checkbox"
            name="isDefault"
            defaultChecked={state?.values?.isDefault === 'true'}
            className="mt-0.5 size-4.5 accent-[var(--brand)]"
          />
          <span className="text-sm">
            Use this as my default address
            <span className="block text-xs text-muted-foreground">
              Checkout will fill this one in unless you pick another.
            </span>
          </span>
        </label>
      )}

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <div className="min-w-[11rem] flex-1 sm:max-w-[14rem]">
          <SubmitButton pending={pending} pendingLabel="Saving…">
            {address ? 'Save changes' : 'Save address'}
          </SubmitButton>
        </div>
        <Link
          href="/account/addresses"
          className="flex h-12 items-center rounded-full px-5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
