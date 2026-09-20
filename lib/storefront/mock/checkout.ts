/*
 * Checkout fixtures: the countries this store ships to and the ways it can
 * be paid.
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

/*
 * Payment methods.
 *
 * 'squad' — Squad's hosted payment page, which offers the shopper card and
 * bank transfer (and whatever else the Squad account has switched on). The
 * shopper pays on Squad's page, not ours — no card field exists anywhere in
 * the storefront, and none should.
 *
 * 'pod' — pay on delivery. Nothing is charged online; the order holds its
 * stock without a time limit and the merchant records the money when the
 * courier collects it (Sales → Orders).
 *
 * 'transfer' — bank transfer to the merchant's own account (BANK_TRANSFER_METHOD
 * below). Only offered when the store has an active bank account, so it is
 * added per store by checkout/store-config.ts rather than listed here.
 *
 * `handoffNote` is shown once the method is picked and says what happens
 * next, in the future tense, because nothing has happened yet.
 */
export const CHECKOUT_PAYMENT_METHODS: PaymentMethodOption[] = [
  {
    id: 'squad',
    label: 'Pay online',
    description: 'Card or bank transfer, through Squad',
    handoffNote:
      'After you place this order you’ll go to Squad’s secure payment page to pay by card or bank transfer. No card details are entered on this site.',
    provider: 'squad',
    enabled: true,
  },
  {
    id: 'pod',
    label: 'Pay on delivery',
    description: 'Pay the courier when your order arrives',
    handoffNote:
      'Nothing is charged now. The store will confirm your order, and you pay the courier when it arrives — have the exact total ready if you’re paying cash.',
    provider: 'manual',
    enabled: true,
  },
];

/** How long a bank-transfer order holds its stock before it is cancelled unpaid. */
export const TRANSFER_HOLD_HOURS = 48;

/** Offered last, and only to stores with at least one active bank account. */
export const BANK_TRANSFER_METHOD: PaymentMethodOption = {
  id: 'transfer',
  label: 'Bank transfer',
  description: 'Transfer the total to the store’s bank account',
  handoffNote: `After you place this order you’ll see the store’s bank details. Transfer the exact total within ${TRANSFER_HOLD_HOURS} hours and use your order number as the reference — the store confirms your order once the money arrives.`,
  provider: 'manual',
  enabled: true,
};

/** Whether this store lets people buy without an account. */
export const GUEST_CHECKOUT_ENABLED = true;

/** Whether checkout shows a tax line. Prices already include VAT. */
export const CHECKOUT_TAX_ENABLED = false;

/** Whether the shopper may leave a note with the order. */
export const ORDER_NOTES_ENABLED = true;
