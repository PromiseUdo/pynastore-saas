'use server';

/*
 * features/shop-account/address-actions.ts
 *
 * The shopper's address book, from a form.
 *
 * Like the rest of this folder, every action resolves the store from the
 * request header and the customer from the session cookie — never from the
 * form. The only id a form is allowed to carry is the address's own, and
 * that one is checked against the session's customer inside every query
 * (lib/storefront/account/addresses.ts).
 *
 * VALIDATION USES CHECKOUT'S OWN RULES. The country list, the region list
 * and whether a postal code is required all come from the store's checkout
 * config, so an address saved here is an address checkout will accept. A
 * second, slightly different set of rules in the account area is how a
 * shopper ends up with a saved address that fails at the till.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import {
  createAddress,
  deleteAddress,
  saveAddressIfNew,
  setDefaultAddress,
  updateAddress,
  type AddressInput,
} from '@/lib/storefront/account/addresses';
import { findStoreBySlug } from '@/lib/storefront/account/shopper';
import { currentStoreSlug, getShopper } from '@/lib/storefront/account/session';
import { getCheckoutConfig } from '@/lib/storefront/checkout/config';
import { countryName, postalCodeRequired } from '@/lib/storefront/checkout/address';
import { findCountry } from '@/lib/storefront/checkout/config';
import { phoneSchema } from '@/lib/storefront/checkout/schema';

type AddressField =
  | 'fullName'
  | 'phone'
  | 'line1'
  | 'line2'
  | 'city'
  | 'state'
  | 'country'
  | 'postalCode';

export type AddressFormState = {
  error?: string;
  fieldErrors?: Partial<Record<AddressField, string>>;
  values?: Record<string, string>;
} | null;

const NOT_SIGNED_IN = 'Your session has ended. Please sign in again.';

async function context() {
  const slug = await currentStoreSlug();
  const [store, shopper] = await Promise.all([
    slug ? findStoreBySlug(slug) : null,
    getShopper(),
  ]);
  if (!store || !shopper) return null;
  return { store, shopper, scope: { organizationId: store.id, customerId: shopper.id } };
}

const BaseSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter the recipient’s full name.'),
  phone: phoneSchema,
  line1: z.string().trim().min(3, 'Enter the street address.'),
  line2: z.string().trim().optional().or(z.literal('')),
  city: z.string().trim().min(1, 'Enter the city or town.'),
  state: z.string().trim().min(1, 'Choose a state or region.'),
  country: z.string().trim().min(1, 'Choose a country.'),
  postalCode: z.string().trim().optional().or(z.literal('')),
});

function readForm(formData: FormData) {
  const get = (key: string) => String(formData.get(key) ?? '');
  return {
    fullName: get('fullName'),
    phone: get('phone'),
    line1: get('line1'),
    line2: get('line2'),
    city: get('city'),
    state: get('state'),
    country: get('country'),
    postalCode: get('postalCode'),
    isDefault: formData.get('isDefault') === 'on',
  };
}

/**
 * Save a new address, or an edit to one. `id` decides which — and is the
 * only thing the form is trusted with, because ownership is re-checked in
 * the query itself.
 */
export async function saveAddressAction(
  _prev: AddressFormState,
  formData: FormData,
): Promise<AddressFormState> {
  const ctx = await context();
  if (!ctx) return { error: NOT_SIGNED_IN };

  const id = String(formData.get('id') ?? '').trim();
  const raw = readForm(formData);
  const values = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, typeof v === 'boolean' ? String(v) : v]),
  );

  const config = await getCheckoutConfig({ organizationSlug: ctx.store.slug });
  const parsed = BaseSchema.safeParse(raw);

  const fieldErrors: Partial<Record<AddressField, string>> = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as AddressField;
      fieldErrors[field] ??= issue.message;
    }
  }

  // Country-specific rules, from the same config the checkout form uses.
  const country = findCountry(config, raw.country);
  if (!country) {
    fieldErrors.country ??= 'Choose a country we deliver to.';
  } else {
    if (country.regions.length > 0 && !country.regions.includes(raw.state)) {
      fieldErrors.state ??= `Choose a ${country.regionLabel.toLowerCase()} from the list.`;
    }
    if (postalCodeRequired(config, country.code) && !raw.postalCode) {
      fieldErrors.postalCode ??= 'Enter the postcode.';
    }
  }

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors, values };

  const input: AddressInput = {
    fullName: raw.fullName.trim(),
    phone: raw.phone.trim(),
    line1: raw.line1.trim(),
    line2: raw.line2.trim() || undefined,
    city: raw.city.trim(),
    state: raw.state.trim(),
    // Stored as the display name, which is what the address book shows and
    // what `fromStoredAddress` matches back to a code.
    country: countryName(config, raw.country),
    postalCode: raw.postalCode.trim() || undefined,
    isDefault: raw.isDefault,
  };

  const result = id
    ? await updateAddress(ctx.scope, id, input)
    : await createAddress(ctx.scope, input);

  if (!result.ok) {
    return {
      error:
        result.reason === 'too-many'
          ? 'That’s as many addresses as we can save. Remove one you no longer use first.'
          : 'We couldn’t find that address on your account.',
      values,
    };
  }

  revalidatePath('/account/addresses');
  redirect('/account/addresses');
}

export async function deleteAddressAction(formData: FormData): Promise<void> {
  const ctx = await context();
  if (!ctx) redirect('/account/sign-in?next=%2Faccount%2Faddresses');

  const id = String(formData.get('id') ?? '').trim();
  if (id) await deleteAddress(ctx.scope, id);

  revalidatePath('/account/addresses');
  redirect('/account/addresses');
}

export async function setDefaultAddressAction(formData: FormData): Promise<void> {
  const ctx = await context();
  if (!ctx) redirect('/account/sign-in?next=%2Faccount%2Faddresses');

  const id = String(formData.get('id') ?? '').trim();
  if (id) await setDefaultAddress(ctx.scope, id);

  revalidatePath('/account/addresses');
  redirect('/account/addresses');
}

/**
 * Save the address a shopper typed at checkout, when they ticked the box.
 *
 * Not a form action: it is called after an order is placed, with the address
 * the order already used. It is deliberately quiet — a shopper who has just
 * ordered should never see "we couldn't save your address" as the last word
 * on their confirmation, so failures return false and the caller ignores
 * them. The order does not depend on this.
 *
 * `saveAddressIfNew` does the de-duplicating, so ticking the box on every
 * order doesn't fill the book with the same house five times.
 */
export async function saveCheckoutAddressAction(input: {
  fullName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  country: string;
  postalCode?: string;
}): Promise<boolean> {
  const ctx = await context();
  if (!ctx) return false;

  const parsed = BaseSchema.safeParse({
    fullName: input.fullName,
    phone: input.phone,
    line1: input.line1,
    line2: input.line2 ?? '',
    city: input.city,
    state: input.state,
    country: input.country,
    postalCode: input.postalCode ?? '',
  });
  if (!parsed.success) return false;

  const result = await saveAddressIfNew(ctx.scope, {
    fullName: input.fullName.trim(),
    phone: input.phone.trim(),
    line1: input.line1.trim(),
    line2: input.line2?.trim() || undefined,
    city: input.city.trim(),
    state: input.state.trim(),
    // Already a display name here: checkout converts with `toStoredAddress`.
    country: input.country.trim(),
    postalCode: input.postalCode?.trim() || undefined,
  });

  if (result.ok) revalidatePath('/account/addresses');
  return result.ok;
}
