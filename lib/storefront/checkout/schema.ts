/*
 * lib/storefront/checkout/schema.ts
 *
 * Checkout validation, as Zod schemas — the same library the server actions
 * in features/* already validate with, so there is one validation idiom in
 * the codebase rather than two.
 *
 * Two things shape what's here:
 *
 *  1. MESSAGES ARE THE UX. Every rule carries the sentence the shopper
 *     reads ("Enter a valid email address."), because a rule and its
 *     explanation drifting apart is how a form ends up saying "invalid".
 *     Nothing in checkout renders a generic "form is invalid".
 *
 *  2. THE COUNTRY DECIDES. Postal codes are required in the UK and the US
 *     and optional in Nigeria, so the schema is a FACTORY over the store's
 *     `CheckoutConfig`: the rules come from the same data the address form
 *     labels itself from. Phone numbers are checked loosely on purpose —
 *     a country-specific pattern is a bug waiting for the first shopper
 *     from somewhere we didn't think of.
 *
 * This is CLIENT-SIDE validation: it catches typos early. It is not a
 * security boundary. The browser is not trusted, and the real backend will
 * revalidate every field of this — plus price, stock and delivery, which
 * the client cannot be allowed an opinion on at all.
 */
import { z } from 'zod';
import type { CheckoutConfig } from './types';

/** Digits in a phone number, ignoring spaces, dashes, brackets and '+'. */
export function phoneDigits(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Deliberately permissive: 7–15 digits is E.164's own range, and anything
 * stricter starts rejecting real numbers. The provider validates properly
 * when it sends the OTP.
 */
export const phoneSchema = z
  .string()
  .trim()
  .min(1, 'Enter your phone number.')
  /* Every rule below skips the empty case. Zod runs all of them and
   * collects every failure, so without the guard a blank field would report
   * "enter your phone number", "use digits only" AND "too short" at once —
   * and the field would render whichever of the three came last. One field,
   * one sentence. */
  .refine((v) => v.length === 0 || /^[+(\d][\d\s()\-.]*$/.test(v), 'Use digits, spaces and dashes only.')
  .refine((v) => v.length === 0 || phoneDigits(v).length >= 7, 'That phone number looks too short.')
  .refine((v) => v.length === 0 || phoneDigits(v).length <= 15, 'That phone number looks too long.');

export const contactSchema = z.object({
  firstName: z.string().trim().min(1, 'Enter your first name.').max(60, 'That’s longer than 60 characters.'),
  lastName: z.string().trim().min(1, 'Enter your last name.').max(60, 'That’s longer than 60 characters.'),
  email: z
    .string()
    .trim()
    .min(1, 'Enter your email address.')
    .pipe(z.email('Enter a valid email address.')),
  phone: phoneSchema,
});

/**
 * The address rules that hold everywhere. Country-specific ones (the postal
 * code, and a region that must come from a list) are applied by
 * `checkoutSchema` below, which has the config to hand.
 */
export const addressSchema = z.object({
  firstName: z.string().trim().min(1, 'Enter the recipient’s first name.'),
  lastName: z.string().trim().min(1, 'Enter the recipient’s last name.'),
  phone: phoneSchema,
  country: z.string().trim().min(1, 'Choose a country.'),
  state: z.string().trim().min(1, 'Choose a state or region.'),
  city: z.string().trim().min(1, 'Enter your city or town.'),
  /* One message at a time: an empty field is asked to be filled in, and
   * only a field with something in it is told it needs more detail. Two
   * `.min()` rules would emit both at once. */
  addressLine1: z
    .string()
    .trim()
    .min(1, 'Enter your delivery address.')
    .refine((v) => v.length === 0 || v.length >= 5, 'Give a bit more detail — street and number.')
    .refine((v) => v.length <= 120, 'That’s longer than 120 characters.'),
  addressLine2: z.string().trim().max(120, 'That’s longer than 120 characters.'),
  postalCode: z.string().trim().max(16, 'That postal code looks too long.'),
});

/**
 * The whole checkout draft.
 *
 * Built from the store's config so the delivery and payment ids it accepts
 * are exactly the ones the store offers — a hand-edited id in a devtools
 * console fails here, and would fail again on the server later.
 */
export function checkoutSchema(config: CheckoutConfig) {
  const paymentIds = config.paymentMethods.map((m) => m.id);
  const countryCodes = config.countries.map((c) => c.code);

  return z
    .object({
      contact: contactSchema,
      address: addressSchema,
      deliveryMethodId: z
        .string({ error: 'Choose how you’d like your order delivered.' })
        // Which ids are valid depends on the address; the options on screen come
        // from the server's quote, and the server re-quotes when placing the order.
        .min(1, 'Choose how you’d like your order delivered.'),
      paymentMethodId: z
        .string({ error: 'Choose how you’d like to pay.' })
        .min(1, 'Choose how you’d like to pay.')
        .refine((id) => paymentIds.includes(id), 'That payment method isn’t available.'),
      orderNote: z.string().trim().max(500, 'Keep your note under 500 characters.'),
    })
    .superRefine((draft, ctx) => {
      const country = config.countries.find((c) => c.code === draft.address.country);

      if (!countryCodes.includes(draft.address.country)) {
        ctx.addIssue({
          code: 'custom',
          path: ['address', 'country'],
          message: 'We don’t deliver to that country yet.',
        });
        return;
      }

      if (country?.postalCodeRequired && draft.address.postalCode.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['address', 'postalCode'],
          message: `Enter your ${country.postalCodeLabel.toLowerCase()}.`,
        });
      }

      /* A country whose regions we carry gets a select, so a value outside
       * the list means the payload was edited, not mistyped. Countries with
       * an empty list accept free text — see mock/checkout.ts. */
      if (
        country &&
        country.regions.length > 0 &&
        /* An empty region already has its own message from `addressSchema`;
         * adding "not in the list" on top just doubles it up. */
        draft.address.state.length > 0 &&
        !country.regions.includes(draft.address.state)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['address', 'state'],
          message: `Choose a ${country.regionLabel.toLowerCase()} from the list.`,
        });
      }
    });
}

export type CheckoutFormValues = z.input<ReturnType<typeof checkoutSchema>>;

/** The fields each step owns, so a step can be validated without the rest. */
export const STEP_FIELDS = {
  information: ['contact', 'address'],
  delivery: ['deliveryMethodId'],
  payment: ['paymentMethodId'],
  review: [],
} as const;
