/*
 * lib/storefront/checkout/address.ts
 *
 * The one place a checkout address is built, labelled, printed, or
 * converted.
 *
 * Two address shapes exist in the storefront and they do different jobs:
 *
 *   CheckoutAddress   what a form collects — first/last name, an ISO country
 *                     code, no id. Used by EVERY checkout component.
 *   Address           a saved address-book entry (lib/storefront/types.ts):
 *                     has an id, a single `fullName`, a default flag, and a
 *                     country as a display name. Owned by the account area.
 *
 * Rather than bend one over both jobs, the conversion lives here — once —
 * so no component ever maps address fields by hand.
 */
import type { Address } from '../types';
import type { CheckoutAddress, CheckoutConfig, CheckoutContact } from './types';
import { findCountry } from './config';

export function emptyAddress(countryCode: string): CheckoutAddress {
  return {
    firstName: '',
    lastName: '',
    phone: '',
    country: countryCode,
    state: '',
    city: '',
    addressLine1: '',
    addressLine2: '',
    postalCode: '',
  };
}

/**
 * Stamp the recipient onto an address from the contact step.
 *
 * The courier needs a name and a phone, but asking for them twice is the
 * kind of friction that loses orders — so the address carries them and the
 * form fills them from contact. A shopper sending a gift elsewhere can
 * eventually override them; the model already allows it.
 */
export function addressFromContact(address: CheckoutAddress, contact: CheckoutContact): CheckoutAddress {
  return {
    ...address,
    firstName: address.firstName || contact.firstName,
    lastName: address.lastName || contact.lastName,
    phone: address.phone || contact.phone,
  };
}

/** Display name for the country code held on an address. */
export function countryName(config: CheckoutConfig, code: string): string {
  return findCountry(config, code)?.name ?? code;
}

/** Whether this address's country insists on a postal code. */
export function postalCodeRequired(config: CheckoutConfig, code: string): boolean {
  return findCountry(config, code)?.postalCodeRequired ?? false;
}

/**
 * The address as lines, for review and confirmation panels.
 *
 * Returns an array rather than a joined string so the caller decides whether
 * it's a `<br>`-separated block or a one-line summary — and so empty
 * optional fields simply don't produce a line.
 */
export function addressLines(address: CheckoutAddress, config: CheckoutConfig): string[] {
  const region = [address.city, address.state].filter(Boolean).join(', ');
  return [
    `${address.firstName} ${address.lastName}`.trim(),
    address.addressLine1,
    address.addressLine2,
    [region, address.postalCode].filter(Boolean).join(' '),
    countryName(config, address.country),
    address.phone,
  ].filter((line) => line.trim().length > 0);
}

/** A one-line summary: "Port Harcourt, Rivers" — for a collapsed section. */
export function addressSummary(address: CheckoutAddress): string {
  return [address.city, address.state].filter(Boolean).join(', ');
}

/* ---------------- account address-book interop ---------------- */

/** A saved address-book entry, as checkout's form wants it. */
export function fromStoredAddress(stored: Address, config: CheckoutConfig): CheckoutAddress {
  const [firstName = '', ...rest] = stored.fullName.trim().split(/\s+/);
  const matched = config.countries.find(
    (c) => c.name.toLowerCase() === stored.country.toLowerCase() || c.code === stored.country,
  );
  return {
    firstName,
    lastName: rest.join(' '),
    phone: stored.phone,
    country: matched?.code ?? config.defaultCountryCode,
    state: stored.state,
    city: stored.city,
    addressLine1: stored.line1,
    addressLine2: stored.line2 ?? '',
    postalCode: stored.postalCode ?? '',
  };
}

/** A checkout address, as the account address book stores one. */
export function toStoredAddress(
  address: CheckoutAddress,
  config: CheckoutConfig,
): Omit<Address, 'id'> {
  return {
    fullName: `${address.firstName} ${address.lastName}`.trim(),
    phone: address.phone,
    line1: address.addressLine1,
    line2: address.addressLine2 || undefined,
    city: address.city,
    state: address.state,
    country: countryName(config, address.country),
    postalCode: address.postalCode || undefined,
  };
}
