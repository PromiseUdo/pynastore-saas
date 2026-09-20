'use client';

/*
 * Checkout state: one object, one owner.
 *
 * Everything the shopper has entered (contact, address, delivery choice,
 * payment choice, note), plus where they are in the flow and whether a
 * submission is in flight. Components read and write THIS; none of them
 * keeps its own copy of a field, which is what makes moving backwards
 * between steps lossless — going back is a `setStep`, not a remount that
 * throws away what you typed.
 *
 * NOT PERSISTED, on purpose. A half-filled checkout restored a week later is
 * a stale address quietly attached to a new order. The bag persists because
 * a bag is a shopping list; a checkout is a single sitting. A PLACED order
 * needs no store at all any more: it lives in the merchant's database, and
 * the confirmation page reads it back by the token in its URL.
 *
 * THE CART BOUNDARY. This store never touches localStorage and never reads a
 * cart key. It asks the cart store (./cart-store.ts) for the lines and calls
 * its `clear()` action when an order is placed. Checkout does not know how
 * the bag is stored, and the day the bag becomes a server cart nothing here
 * changes.
 */
import { create } from 'zustand';
import type {
  CheckoutAddress,
  CheckoutConfig,
  CheckoutContact,
  CheckoutStepId,
  CheckoutSubmissionStatus,
} from '../checkout/types';
import type { CheckoutFailure, CheckoutResult } from '../checkout/checkout-service';
import { submitCheckout } from '../checkout/checkout-service';
import { emptyAddress, addressFromContact } from '../checkout/address';
import { useCartStore } from './cart-store';
import type { ShippingMethod } from '../types';

const EMPTY_CONTACT: CheckoutContact = { firstName: '', lastName: '', email: '', phone: '' };

interface CheckoutState {
  contact: CheckoutContact;
  address: CheckoutAddress;
  deliveryMethodId: string | null;
  paymentMethodId: string | null;
  orderNote: string;

  step: CheckoutStepId;
  /** the furthest step reached, so a shopper can jump back and forth */
  furthestStep: CheckoutStepId;
  status: CheckoutSubmissionStatus;
  /** the last rejection, shown once near the Place Order button */
  failure: CheckoutFailure | null;
  /** what the server gave back, so a second tap can answer without re-submitting */
  placed: {
    reference: string;
    confirmationToken: string;
    paymentUrl: string | null;
    confirmationPath: string;
  } | null;

  setContact: (patch: Partial<CheckoutContact>) => void;
  setAddress: (patch: Partial<CheckoutAddress>) => void;
  setDeliveryMethod: (id: string) => void;
  setPaymentMethod: (id: string) => void;
  setOrderNote: (note: string) => void;
  setStep: (step: CheckoutStepId) => void;
  clearFailure: () => void;
  /** seed the defaults that come from the store's config */
  initialize: (config: CheckoutConfig) => void;
  reset: (config?: CheckoutConfig) => void;

  placeOrder: (args: {
    config: CheckoutConfig;
    tenantId: string;
    /** the delivery options quoted for the shopper's address */
    deliveryOptions?: ShippingMethod[];
  }) => Promise<CheckoutResult>;
}

const STEP_ORDER: CheckoutStepId[] = ['information', 'delivery', 'payment', 'review'];

function furthest(a: CheckoutStepId, b: CheckoutStepId): CheckoutStepId {
  return STEP_ORDER.indexOf(a) >= STEP_ORDER.indexOf(b) ? a : b;
}

export const useCheckoutStore = create<CheckoutState>((set, get) => ({
  contact: EMPTY_CONTACT,
  address: emptyAddress(''),
  deliveryMethodId: null,
  paymentMethodId: null,
  orderNote: '',

  step: 'information',
  furthestStep: 'information',
  status: 'idle',
  failure: null,
  placed: null,

  setContact: (patch) => set((s) => ({ contact: { ...s.contact, ...patch } })),
  setAddress: (patch) => set((s) => ({ address: { ...s.address, ...patch } })),
  setDeliveryMethod: (id) => set({ deliveryMethodId: id, failure: null }),
  setPaymentMethod: (id) => set({ paymentMethodId: id, failure: null }),
  setOrderNote: (orderNote) => set({ orderNote }),

  setStep: (step) =>
    set((s) => ({ step, furthestStep: furthest(s.furthestStep, step), failure: null })),

  clearFailure: () => set({ failure: null }),

  /*
   * Defaults the STORE decides, not the component: the country to show and
   * the delivery method to pre-select come from the tenant's config. Only
   * fills what is still blank, so re-mounting the checkout page (a step
   * navigation, a fast refresh) can't stomp on a typed address.
   */
  initialize: (config) =>
    set((s) => ({
      address: s.address.country ? s.address : emptyAddress(config.defaultCountryCode),
      deliveryMethodId: s.deliveryMethodId ?? config.defaultDeliveryMethodId ?? null,
    })),

  reset: (config) =>
    set({
      contact: EMPTY_CONTACT,
      address: emptyAddress(config?.defaultCountryCode ?? ''),
      deliveryMethodId: config?.defaultDeliveryMethodId ?? null,
      paymentMethodId: null,
      orderNote: '',
      step: 'information',
      furthestStep: 'information',
      status: 'idle',
      failure: null,
      placed: null,
    }),

  /*
   * Place the order. The only writer of an order in the storefront.
   *
   * DUPLICATE SUBMISSION. The guard is the first line, before any await: a
   * second call while one is in flight returns the in-flight promise's
   * eventual shape rather than starting a second order. The button is also
   * disabled, but a disabled button is a courtesy — a double-tap on a slow
   * phone, a stuck Enter key or a re-fired submit event all arrive here, and
   * here is where "exactly one order" has to be true. `status === 'placed'`
   * keeps it true afterwards too, so a back-navigation onto a finished
   * checkout cannot re-submit.
   *
   * ORDER OF OPERATIONS, which matters:
   *   1. validate + create the order
   *   2. record it (so a refresh of the confirmation finds it)
   *   3. ONLY THEN clear the bag
   * A failure at step 1 leaves the bag exactly as it was — nobody loses
   * their shopping because our mock said no.
   */
  placeOrder: async ({ config, tenantId, deliveryOptions }) => {
    const state = get();
    if (state.status === 'submitting' || state.status === 'placed') {
      /* A second tap while the first is in flight, or after it landed. The
       * first answer is the only one; re-submitting would be a second order. */
      if (state.status === 'placed' && state.placed) return { ok: true, ...state.placed };
      return { ok: false, code: 'order-failed', message: 'Your order is already being placed.' };
    }

    set({ status: 'submitting', failure: null });

    const contact = state.contact;
    const address = addressFromContact(state.address, contact);
    /* The bag is asked for its lines through its own action — checkout has
     * no idea where they are kept. */
    const items = useCartStore.getState().getItems();

    const result = await submitCheckout({
      tenantId,
      items,
      contact,
      address,
      deliveryMethodId: state.deliveryMethodId,
      paymentMethodId: state.paymentMethodId,
      orderNote: state.orderNote,
      /* The bag owns the code, the same way it owns the lines — checkout
       * never keeps its own copy of either. */
      coupon: useCartStore.getState().coupon,
      config,
      deliveryOptions,
    });

    if (!result.ok) {
      set({ status: 'failed', failure: result });
      return result;
    }

    /* The bag is emptied only once the order exists on the server — and
     * through the cart store's own action, which the header badge, the
     * mini-cart and /cart all subscribe to. */
    useCartStore.getState().clear();
    set({
      status: 'placed',
      failure: null,
      placed: {
        reference: result.reference,
        confirmationToken: result.confirmationToken,
        paymentUrl: result.paymentUrl,
        confirmationPath: result.confirmationPath,
      },
    });
    return result;
  },
}));


