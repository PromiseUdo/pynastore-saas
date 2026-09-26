/*
 * lib/storefront/checkout/checkout-service.ts
 *
 * The one call the Place Order button makes.
 *
 *   checkout UI → this file → pre-flight checks → placeOrderAction (server)
 *                              → catalogue re-priced · order written
 *
 * The pre-flight checks below catch the shopper's mistakes early and keep a
 * corrupt localStorage bag from reaching the server at all. They secure
 * NOTHING: the browser is not trusted, this file included, and every one of
 * them is re-done in lib/storefront/orders/create.ts against the merchant's
 * own catalogue. The prices in the bag are never sent — only ids and
 * quantities — precisely because a price that comes from a browser is a
 * price a browser can edit.
 *
 * A rejected checkout is an ordinary answer ("that's out of stock"), not an
 * exception, so this returns a discriminated result and the server answers
 * in the same shape.
 */
import { isNativeApp } from '../payments/open-payment-page';
import type { AppliedCoupon, CartItem, ShippingMethod } from '../types';
import type {
  CheckoutAddress,
  CheckoutConfig,
  CheckoutContact,
} from './types';
import { findPaymentMethod } from './config';
import { isPaymentMethodAllowed, PREPAYMENT_REQUIRED_MESSAGE } from './payment-terms';
import { checkoutSchema } from './schema';
import { MAX_LINE_QUANTITY } from '../cart';
import { placeOrderAction } from '@/features/shop-orders/actions';

export type CheckoutFailureCode =
  | 'empty-cart'
  | 'invalid-details'
  | 'invalid-delivery-method'
  | 'invalid-payment-method'
  | 'invalid-cart-item'
  | 'product-unavailable'
  | 'invalid-discount'
  | 'order-failed';

export interface CheckoutFailure {
  ok: false;
  code: CheckoutFailureCode;
  /** shown to the shopper — never a stack trace, never a field path */
  message: string;
}

export interface CheckoutSuccess {
  ok: true;
  /** what the shopper quotes to support: ORD-2026-000123 */
  reference: string;
  /** unguessable key the confirmation page is read with */
  confirmationToken: string;
  /** the payment provider's page to send the shopper to; null means go
   *  straight to the confirmation, which offers "Pay now" */
  paymentUrl: string | null;
  /** the confirmation page as this shopper's browser addresses it */
  confirmationPath: string;
}

export type CheckoutResult = CheckoutSuccess | CheckoutFailure;

export interface SubmitCheckoutInput {
  tenantId: string;
  items: CartItem[];
  contact: CheckoutContact;
  address: CheckoutAddress;
  deliveryMethodId: string | null;
  paymentMethodId: string | null;
  orderNote: string;
  /** the code applied in the bag, if any — the server checks it again */
  coupon?: AppliedCoupon | null;
  config: CheckoutConfig;
  /** the options quoted for this address (checkout's delivery step); defaults to the config's fixed list */
  deliveryOptions?: ShippingMethod[];
  now?: Date;
}

const deliveryOptionsOf = (input: SubmitCheckoutInput) => input.deliveryOptions ?? input.config.deliveryMethods;
const findDeliveryOption = (input: SubmitCheckoutInput) =>
  deliveryOptionsOf(input).find((m) => m.id === input.deliveryMethodId) ?? null;

const fail = (code: CheckoutFailureCode, message: string): CheckoutFailure => ({ ok: false, code, message });

/** The server's refusals this side has a name for; anything else is generic. */
const KNOWN_FAILURES = [
  'empty-cart',
  'invalid-delivery-method',
  'invalid-payment-method',
  'product-unavailable',
  'invalid-discount',
  'order-failed',
] as const satisfies readonly CheckoutFailureCode[];

/**
 * Is this line still something we could sell?
 *
 * A bag line is user-writable storage that has already been sanitised once
 * (lib/storefront/cart.ts). This is the second look, at the point where it
 * would become an order: a zero price, an absurd quantity or a quantity
 * above the stock the snapshot itself recorded means the line is not fit to
 * charge for, whatever it looks like on screen.
 */
function lineProblem(item: CartItem): CheckoutFailureCode | null {
  if (!item.productId || !item.variantId) return 'invalid-cart-item';
  if (!Number.isFinite(item.unitPrice) || item.unitPrice <= 0) return 'invalid-cart-item';
  if (!Number.isInteger(item.quantity) || item.quantity < 1) return 'invalid-cart-item';
  if (item.quantity > MAX_LINE_QUANTITY) return 'invalid-cart-item';
  if (item.maxQuantity <= 0) return 'product-unavailable';
  if (item.quantity > item.maxQuantity) return 'product-unavailable';
  return null;
}

/**
 * Everything that must be true before an order can exist, checked in the
 * order a shopper would want to hear about it: is there anything to buy,
 * are the details right, are the choices real, are the goods sellable.
 *
 * Exported separately from `submitCheckout` so the Review step can ask
 * "would this go through?" without submitting anything.
 */
export function validateCheckout(input: SubmitCheckoutInput): CheckoutFailure | null {
  if (input.items.length === 0) {
    return fail('empty-cart', 'Your bag is empty. Add something to it before checking out.');
  }

  const parsed = checkoutSchema(input.config).safeParse({
    contact: input.contact,
    address: input.address,
    deliveryMethodId: input.deliveryMethodId ?? '',
    paymentMethodId: input.paymentMethodId ?? '',
    orderNote: input.orderNote,
  });

  if (!parsed.success) {
    /* Which field is wrong is the FORM's job to say, beside the field
     * (react-hook-form already has the same issues). This message only has
     * to get the shopper looking in the right place. */
    const path = parsed.error.issues[0]?.path ?? [];
    if (path[0] === 'deliveryMethodId') {
      return fail('invalid-delivery-method', 'Choose how you’d like your order delivered.');
    }
    if (path[0] === 'paymentMethodId') {
      return fail('invalid-payment-method', 'Choose how you’d like to pay.');
    }
    return fail('invalid-details', 'Some of your details need another look — check the highlighted fields.');
  }

  if (!findDeliveryOption(input)) {
    return fail('invalid-delivery-method', 'That delivery option is no longer available. Pick another one.');
  }
  const paymentMethod = findPaymentMethod(input.config, input.paymentMethodId);
  if (!paymentMethod) {
    return fail('invalid-payment-method', 'That payment method is no longer available. Pick another one.');
  }
  /* Pay on delivery against a bag the merchant wants paid up front. The
   * payment step already greys this out; a bag edited in another tab, or a
   * hand-edited draft, arrives here. */
  if (!isPaymentMethodAllowed(paymentMethod, input.items)) {
    return fail('invalid-payment-method', PREPAYMENT_REQUIRED_MESSAGE);
  }

  for (const item of input.items) {
    const problem = lineProblem(item);
    if (problem === 'product-unavailable') {
      return fail(
        'product-unavailable',
        `${item.name} isn’t available in the quantity you asked for. Go back to your bag to adjust it.`,
      );
    }
    if (problem) {
      return fail(
        'invalid-cart-item',
        'Something in your bag doesn’t look right. Go back to your bag and try again.',
      );
    }
  }

  return null;
}

/**
 * Place the order.
 *
 * Validates, then creates. It does NOT clear the bag and it does NOT
 * navigate — the caller does both, and only on `ok: true`, so a rejected
 * checkout leaves the shopper exactly where they were with everything they
 * typed still there.
 *
 * Duplicate submission is not defended against here: this function has no
 * memory and would happily make two orders. Guarding it is the store's job
 * (see `placeOrder` in lib/storefront/stores/checkout-store.ts), which is
 * also where the real request's idempotency key will live.
 */
export async function submitCheckout(input: SubmitCheckoutInput): Promise<CheckoutResult> {
  const invalid = validateCheckout(input);
  if (invalid) return invalid;

  const deliveryMethod = findDeliveryOption(input);
  const paymentMethod = findPaymentMethod(input.config, input.paymentMethodId);
  /* `validateCheckout` already proved both resolve; this is for the type
   * checker, and for the day someone calls this without validating. */
  if (!deliveryMethod) return fail('invalid-delivery-method', 'Choose how you’d like your order delivered.');
  if (!paymentMethod) return fail('invalid-payment-method', 'Choose how you’d like to pay.');

  try {
    /* Ids and quantities only. Everything else about the goods — name,
     * price, availability — is the server's to decide. */
    const result = await placeOrderAction({
      lines: input.items.map((item) => ({
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
      })),
      contact: input.contact,
      address: input.address,
      deliveryMethodId: deliveryMethod.id,
      paymentMethodId: paymentMethod.id,
      note: input.orderNote,
      discountCode: input.coupon?.code ?? null,
      nativeApp: isNativeApp(),
    });

    /* The server's own word on the order. A discount that stopped being
     * usable is its own answer, so the shopper can be pointed at the code
     * rather than told "something went wrong"; anything else the server
     * refuses is reported as it stands. */
    if (!result.ok) {
      const code: CheckoutFailureCode =
        result.code && (KNOWN_FAILURES as readonly string[]).includes(result.code)
          ? (result.code as CheckoutFailureCode)
          : 'order-failed';
      return fail(code, result.message);
    }

    return {
      ok: true,
      reference: result.reference,
      confirmationToken: result.confirmationToken,
      paymentUrl: result.paymentUrl ?? null,
      confirmationPath:
        result.confirmationPath ?? `/checkout/confirmation?t=${encodeURIComponent(result.confirmationToken)}`,
    };
  } catch {
    /* Whatever went wrong is ours, not the shopper's, and the detail belongs
     * in the server's logs — not on the screen. */
    return fail('order-failed', 'We couldn’t place your order just then. Nothing was charged — please try again.');
  }
}
