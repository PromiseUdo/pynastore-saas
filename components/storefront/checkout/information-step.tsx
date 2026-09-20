'use client';

/*
 * Step 1 — who you are and where it goes.
 *
 * Contact and address in ONE step rather than two pages: they are the same
 * act ("tell us where to send it"), and splitting them buys a progress dot
 * at the cost of a page load. Four short fields, then the address.
 *
 * GUEST CHECKOUT. There is still no sign-in gate. An email address is all an
 * order needs; signing in is offered as a shortcut in one line at the top,
 * and a shopper who ignores it sees exactly the form they saw before.
 *
 * SIGNED IN. Saved addresses appear as a "Deliver to" choice with the
 * default preselected, and the address fields stay hidden until someone
 * picks "Deliver somewhere else". That turns the longest step in the
 * checkout into reading one card — which is the entire reason an account is
 * worth having here.
 *
 * THE ADDRESS FORM LABELS ITSELF. "State" vs "Region" vs "County", whether
 * there's a list of regions to choose from, and whether a postal code is
 * required all come from the selected country's record in the store's
 * config (see lib/storefront/mock/checkout.ts). No component branches on a
 * country code.
 *
 * The recipient's name and phone are NOT asked for again — the address
 * carries them, filled from contact when the step is submitted. See
 * `addressFromContact`.
 */
import * as React from 'react';
import Link from 'next/link';
import { useWatch, type UseFormReturn } from 'react-hook-form';
import { UserRound } from 'lucide-react';
import type { CheckoutConfig } from '@/lib/storefront/checkout/types';
import type { CheckoutFormValues } from '@/lib/storefront/checkout/schema';
import type { Address } from '@/lib/storefront/types';
import { findCountry } from '@/lib/storefront/checkout/config';
import { FormSection } from '@/components/ui/form-field';
import { TextField, SelectField, FieldRow } from './checkout-fields';
import { SavedAddressPicker, USE_NEW_ADDRESS } from './saved-address-picker';

export function InformationStep({
  form,
  config,
  signedIn,
  savedAddresses,
  selectedAddressId,
  onSelectAddress,
  saveAddress,
  onToggleSaveAddress,
}: {
  form: UseFormReturn<CheckoutFormValues>;
  config: CheckoutConfig;
  signedIn: boolean;
  savedAddresses: Address[];
  /** an address id, or USE_NEW_ADDRESS */
  selectedAddressId: string;
  onSelectAddress: (id: string) => void;
  /** whether a signed-in shopper wants this new address kept */
  saveAddress: boolean;
  onToggleSaveAddress: (next: boolean) => void;
}) {
  const { register, control, setValue, formState } = form;
  const errors = formState.errors;

  /* useWatch, not form.watch(): with the React Compiler on (next.config.ts)
   * a watch() call is memoised away and the choice never re-renders. */
  const countryCode = useWatch({ control, name: 'address.country' });
  const country = findCountry(config, countryCode);
  const phoneHint = country ? `Include your country code, e.g. ${country.phonePrefix} 801 234 5678` : undefined;

  /* Changing country invalidates a region picked from the old country's
   * list — leaving "Rivers" selected under "United Kingdom" would be a
   * value that cannot validate and that the shopper can't see is wrong. */
  const onCountryChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setValue('address.country', event.target.value, { shouldValidate: false });
    setValue('address.state', '', { shouldValidate: false });
  };

  const usingSaved = savedAddresses.length > 0 && selectedAddressId !== USE_NEW_ADDRESS;

  return (
    <div className="space-y-8">
      {/* One line, at the top, for the shoppers it helps — and no wall for
        * the ones it doesn't. `next` brings them straight back here. */}
      {!signedIn && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl border border-border bg-secondary/40 px-4 py-3 text-sm">
          <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          Have an account?
          <Link
            href="/account/sign-in?next=%2Fcheckout"
            className="font-semibold text-brand underline underline-offset-4"
          >
            Sign in
          </Link>
          <span className="text-muted-foreground">and we&apos;ll fill this in for you.</span>
        </p>
      )}

      <FormSection
        title="Contact"
        description="We’ll use this to send your order confirmation and delivery updates."
      >
        <FieldRow>
          <TextField
            id="contact-first-name"
            label="First name"
            autoComplete="given-name"
            error={errors.contact?.firstName?.message}
            {...register('contact.firstName')}
          />
          <TextField
            id="contact-last-name"
            label="Last name"
            autoComplete="family-name"
            error={errors.contact?.lastName?.message}
            {...register('contact.lastName')}
          />
        </FieldRow>

        <TextField
          id="contact-email"
          label="Email address"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          hint="Your receipt and tracking link go here."
          error={errors.contact?.email?.message}
          {...register('contact.email')}
        />

        <TextField
          id="contact-phone"
          label="Phone number"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder={country?.phonePrefix ? `${country.phonePrefix} 801 234 5678` : undefined}
          hint={phoneHint}
          error={errors.contact?.phone?.message}
          {...register('contact.phone')}
        />
      </FormSection>

      <FormSection title="Delivery address" description="Where should we send this order?">
        {savedAddresses.length > 0 && (
          <SavedAddressPicker
            addresses={savedAddresses}
            selectedId={selectedAddressId}
            onSelect={onSelectAddress}
          />
        )}

        {usingSaved ? null : (
          <>
            <SelectField
              id="address-country"
              label="Country"
              options={config.countries.map((c) => ({ value: c.code, label: c.name }))}
              error={errors.address?.country?.message}
              {...register('address.country', { onChange: onCountryChange })}
            />

            <FieldRow>
              {country && country.regions.length > 0 ? (
                <SelectField
                  id="address-state"
                  label={country.regionLabel}
                  placeholder={`Choose a ${country.regionLabel.toLowerCase()}`}
                  options={country.regions.map((r) => ({ value: r, label: r }))}
                  error={errors.address?.state?.message}
                  {...register('address.state')}
                />
              ) : (
                <TextField
                  id="address-state"
                  label={country?.regionLabel ?? 'State / Region'}
                  autoComplete="address-level1"
                  error={errors.address?.state?.message}
                  {...register('address.state')}
                />
              )}

              <TextField
                id="address-city"
                label="City or town"
                autoComplete="address-level2"
                error={errors.address?.city?.message}
                {...register('address.city')}
              />
            </FieldRow>

            <TextField
              id="address-line1"
              label="Address"
              autoComplete="address-line1"
              placeholder="House number and street"
              error={errors.address?.addressLine1?.message}
              {...register('address.addressLine1')}
            />

            <TextField
              id="address-line2"
              label="Apartment, estate, landmark"
              optional
              autoComplete="address-line2"
              hint="Anything that helps the courier find you."
              error={errors.address?.addressLine2?.message}
              {...register('address.addressLine2')}
            />

            <TextField
              id="address-postal-code"
              label={country?.postalCodeLabel ?? 'Postal code'}
              optional={!country?.postalCodeRequired}
              autoComplete="postal-code"
              className="sm:max-w-56"
              error={errors.address?.postalCode?.message}
              {...register('address.postalCode')}
            />

            {/* Offered only to someone who has an account to save it to, and
              * only for an address they are actually typing. */}
            {signedIn && (
              <label className="flex items-start gap-3 rounded-xl border border-border bg-secondary/40 px-4 py-3.5">
                <input
                  type="checkbox"
                  checked={saveAddress}
                  onChange={(event) => onToggleSaveAddress(event.target.checked)}
                  className="mt-0.5 size-4.5 accent-[var(--brand)]"
                />
                <span className="text-sm">
                  Save this address to my account
                  <span className="block text-xs text-muted-foreground">
                    So checkout can fill it in next time.
                  </span>
                </span>
              </label>
            )}
          </>
        )}
      </FormSection>
    </div>
  );
}
