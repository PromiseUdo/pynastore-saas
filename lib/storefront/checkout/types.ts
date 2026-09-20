/*
 * lib/storefront/checkout/types.ts
 *
 * The checkout domain's vocabulary. Checkout is its own domain, one step
 * downstream of the bag: it consumes `CartItem[]` (lib/storefront/types.ts)
 * and produces an order. It does not know how the bag is stored and it does
 * not add up money — see ./totals.ts, which delegates to
 * lib/storefront/pricing.ts.
 *
 * ADDRESSES. There is exactly ONE address shape inside checkout:
 * `CheckoutAddress`. The account area already has its own persisted
 * `Address` (an id, a single `fullName`, a default flag) which is a STORED
 * address-book entry, not the thing a form collects — so rather than bend
 * one shape over both jobs, ./address.ts holds the single pair of
 * converters between them. Every checkout component uses CheckoutAddress;
 * nothing else in checkout invents an address type.
 *
 * DELIVERY. A delivery option is a `ShippingMethod`, the same record the
 * cart's estimate and the PDP's delivery promise already read from
 * lib/storefront/pricing.ts. Checkout charges what the product page
 * promised because there is one list, not three.
 *
 * Money is minor units (kobo) throughout.
 */
import type { Address, CartItem, Money, OrderTotals, ShippingMethod } from '../types';

/* ---------------- what the shopper gives us ---------------- */

/** Who is buying, and where to reach them. Guest checkout needs no more. */
export interface CheckoutContact {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

/**
 * Where it goes.
 *
 * Deliberately generic: `state` is whatever the country calls its top-level
 * region (see `CheckoutCountry.regionLabel`) and `postalCode` is optional
 * because most of the world's addresses either don't have one or don't need
 * it. `country` is an ISO 3166-1 alpha-2 code, never a display name — the
 * label is looked up, so a future language change doesn't invalidate
 * addresses already entered.
 *
 * The recipient's name and phone live on the address (that is what a courier
 * is handed), but the form does not ask for them twice: they default from
 * the contact step. See `addressFromContact` in ./address.ts.
 */
export interface CheckoutAddress {
  firstName: string;
  lastName: string;
  phone: string;
  /** ISO 3166-1 alpha-2 */
  country: string;
  state: string;
  city: string;
  addressLine1: string;
  addressLine2: string;
  postalCode: string;
}

/* ---------------- what the store offers ---------------- */

/**
 * A country checkout can ship to, plus everything its address form needs to
 * label and validate itself. Data, not a switch statement in a component:
 * adding Ghana is a fixture edit.
 */
export interface CheckoutCountry {
  /** ISO 3166-1 alpha-2 */
  code: string;
  name: string;
  /** what this country calls its top-level region — "State", "Province" */
  regionLabel: string;
  /** selectable regions; empty means "free text", which is the honest
   *  default for a country whose list we don't carry */
  regions: string[];
  postalCodeLabel: string;
  postalCodeRequired: boolean;
  /** dialling prefix, used as a placeholder hint only — never enforced */
  phonePrefix: string;
}

/**
 * A payment choice.
 *
 * `provider` says who takes the money: 'squad' sends the shopper to Squad's
 * hosted page after the order exists (lib/storefront/checkout/payment-service.ts);
 * 'manual' would be settled outside the app (a transfer the merchant checks,
 * cash on delivery). Components don't branch on it — the server does.
 */
export interface PaymentMethodOption {
  id: string;
  label: string;
  description: string;
  /** what happens after Place Order, in the shopper's words */
  handoffNote: string;
  provider: 'squad' | 'manual';
  enabled: boolean;
}

/** A merchant bank account as a shopper is shown it (no ids, nothing internal). */
export interface TransferAccount {
  bankName: string;
  accountName: string;
  accountNumber: string;
}

/**
 * One tenant's checkout configuration.
 *
 * Everything a store could reasonably vary — its currency, what it accepts,
 * how it delivers, whether it charges tax, whether guests may buy — in one
 * record, resolved per tenant by ./config.ts. Components read this; they do
 * not carry their own copies of any of it.
 */
export interface CheckoutConfig {
  /** ISO 4217, e.g. 'NGN'. The storefront never hardcodes a symbol. */
  currency: string;
  /** BCP 47 tag used to format that currency */
  locale: string;
  countries: CheckoutCountry[];
  defaultCountryCode: string;
  /** fixed options (demo fixtures only); real stores quote per address — see quoteDeliveryAction */
  deliveryMethods: ShippingMethod[];
  defaultDeliveryMethodId: string;
  /** false when the merchant hasn't set up any delivery or pickup, so checkout can't proceed */
  deliveryAvailable: boolean;
  paymentMethods: PaymentMethodOption[];
  /** the store's active bank accounts; the 'transfer' method is offered only when there are some */
  transferAccounts: TransferAccount[];
  /** when false, checkout shows no tax line at all */
  taxEnabled: boolean;
  /** false would gate checkout behind sign-in; today every store allows guests */
  guestCheckoutEnabled: boolean;
  orderNotesEnabled: boolean;
}

/* ---------------- the flow ---------------- */

export type CheckoutStepId = 'information' | 'delivery' | 'payment' | 'review';

export const CHECKOUT_STEPS: { id: CheckoutStepId; label: string }[] = [
  { id: 'information', label: 'Information' },
  { id: 'delivery', label: 'Delivery' },
  { id: 'payment', label: 'Payment' },
  { id: 'review', label: 'Review' },
];

/** Everything the shopper has entered. One object, not scattered state. */
export interface CheckoutDraft {
  contact: CheckoutContact;
  address: CheckoutAddress;
  deliveryMethodId: string | null;
  paymentMethodId: string | null;
  orderNote: string;
}

export type CheckoutSubmissionStatus = 'idle' | 'validating' | 'submitting' | 'placed' | 'failed';


/** The subtotal/delivery/total shape checkout prints. Re-exported for callers. */
export type { OrderTotals, ShippingMethod, Money };

/*
 * What checkout knows about a signed-in shopper.
 *
 * Resolved on the server by /checkout and handed down; null for a guest, and
 * everything in the flow works the same either way — an account is a
 * shortcut here, never a requirement.
 */
export interface CheckoutAccount {
  /** prefills the contact step */
  contact: Pick<CheckoutContact, 'firstName' | 'lastName' | 'email' | 'phone'>;
  /** the address book, default first (lib/storefront/account/addresses.ts) */
  addresses: Address[];
}
