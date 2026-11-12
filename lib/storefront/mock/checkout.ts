/*
 * Checkout fixtures: the countries this store ships to, and a fixture
 * store's checkout rules.
 *
 * Same rule as everywhere in the storefront — these are DATA, not prose in a
 * component, because the payment list appears in the payment step, the
 * review step and the confirmation, and three copies is how a store ends up
 * offering something it doesn't accept.
 *
 * Delivery options are deliberately NOT here: each merchant sets their own
 * zones and prices (lib/storefront/delivery/), quoted for the shopper's
 * address.
 */
import type { CheckoutCountry, PaymentMethodOption } from '../checkout/types';
import { NIGERIAN_STATES } from '@/lib/geo/nigeria';
import { PAY_ON_DELIVERY_METHOD } from '../checkout/payment-methods';

/*
 * Delivery is Nigeria-only for now: merchants set their delivery zones and
 * prices by Nigerian state and city (Settings → Delivery), so an address
 * anywhere else would have nothing to quote. Adding a country means adding
 * its regions here AND letting zones cover it.
 */
export const CHECKOUT_COUNTRIES: CheckoutCountry[] = [
  {
    code: 'NG',
    name: 'Nigeria',
    regionLabel: 'State',
    regions: [...NIGERIAN_STATES],
    postalCodeLabel: 'Postal code',
    // Nigerian addresses work fine without one, and demanding it loses orders.
    postalCodeRequired: false,
    phonePrefix: '+234',
  },
];

/* The payment methods themselves live in ../checkout/payment-methods.ts;
 * which ones a real store offers is decided by ../checkout/store-config.ts. */
export const CHECKOUT_PAYMENT_METHODS: PaymentMethodOption[] = [PAY_ON_DELIVERY_METHOD];

/* The defaults below are a fixture store's. A real store's come from its own
 * record (Organization.checkoutGuestAllowed / checkoutOrderNotes), applied by
 * ../checkout/store-config.ts. */

/** Whether this store lets people buy without an account. */
export const GUEST_CHECKOUT_ENABLED = true;

/** Whether the shopper may leave a note with the order. */
export const ORDER_NOTES_ENABLED = true;
