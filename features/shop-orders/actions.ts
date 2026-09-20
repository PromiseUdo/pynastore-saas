'use server';

/*
 * features/shop-orders/actions.ts
 *
 * Placing an order, paying for it, and looking one up.
 *
 * The browser sends ids and quantities; it does not send prices, names or
 * totals, and nothing here would believe them if it did — see
 * lib/storefront/orders/create.ts, which rebuilds the whole bag from the
 * merchant's catalogue before writing anything.
 *
 * The store comes from the request header and the shopper from the session
 * cookie. Neither is taken from the payload: an order that believed a form
 * about which store it belonged to would be an order anyone could place in
 * anyone's shop.
 */
import { headers } from 'next/headers';
import { checkRateLimit } from '@/lib/rate-limit';
import { getStoreCheckoutConfig } from '@/lib/storefront/checkout/store-config';
import { findStoreBySlug } from '@/lib/storefront/account/shopper';
import { currentStoreSlug, getShopper } from '@/lib/storefront/account/session';
import { placeOrder, type OrderLineRequest, type PlaceOrderFailure } from '@/lib/storefront/orders/create';
import { findOrderByReferenceAndEmail } from '@/lib/storefront/orders/read';
import { startOrderPayment } from '@/lib/storefront/checkout/payment-service';
import { prisma } from '@/lib/prisma';
import { quoteDelivery } from '@/lib/storefront/delivery/quote';
import { resolveDiscount } from '@/lib/storefront/discounts/resolve';
import { normalizeCode } from '@/lib/storefront/discounts/rules';
import type { AppliedCoupon, ShippingMethod } from '@/lib/storefront/types';
import { findPaymentMethod } from '@/lib/storefront/checkout/config';
import { notifyShopper } from '@/lib/storefront/orders/notifications';
import { isLocalHostname } from '@/lib/tenant/resolveHostname';
import type { CheckoutAddress, CheckoutContact } from '@/lib/storefront/checkout/types';
import type { StorefrontOrder } from '@/lib/storefront/orders/types';

export interface PlaceOrderRequest {
  lines: OrderLineRequest[];
  contact: CheckoutContact;
  address: CheckoutAddress;
  deliveryMethodId: string;
  paymentMethodId: string;
  note: string;
  /** the code the shopper typed, if any — re-checked on the server */
  discountCode?: string | null;
  /** checking out inside the phone app, where payment opens in an in-app browser */
  nativeApp?: boolean;
}

export type PlaceOrderActionResult =
  | {
      ok: true;
      reference: string;
      confirmationToken: string;
      /** Squad's payment page; null for pay on delivery, or when payment
       *  couldn't be started (the confirmation page then offers "Pay now") */
      paymentUrl: string | null;
      /** the confirmation page as this shopper's browser addresses it */
      confirmationPath: string;
    }
  /** `code` says WHICH part was refused, so the bag can point at it */
  | { ok: false; code?: PlaceOrderFailure; message: string };

async function clientIp(): Promise<string> {
  const headerList = await headers();
  const forwarded = headerList.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return headerList.get('x-real-ip') ?? 'unknown';
}

/**
 * The public origin the shopper is on, and the store-relative prefix of its
 * paths — so the payment provider returns them to the store they bought from.
 * The host is trustworthy here: proxy.ts only stamps `x-org-slug` on a request
 * whose host it resolved to that store.
 */
async function storeLocation(slug: string): Promise<{ origin: string; pathPrefix: string }> {
  const headerList = await headers();
  const host = headerList.get('x-forwarded-host') ?? headerList.get('host') ?? '';
  const proto =
    headerList.get('x-forwarded-proto')?.split(',')[0].trim() ??
    (isLocalHostname(host) ? 'http' : 'https');
  // The app's shared mobile origin addresses a store as /s/{slug}/….
  const pathPrefix = headerList.get('x-runtime') === 'mobile' ? `/s/${slug}` : '';
  return { origin: `${proto}://${host}`, pathPrefix };
}

const confirmationPathFor = (pathPrefix: string, token: string) =>
  `${pathPrefix}/checkout/confirmation?t=${encodeURIComponent(token)}`;

export async function placeOrderAction(
  request: PlaceOrderRequest,
): Promise<PlaceOrderActionResult> {
  const slug = await currentStoreSlug();
  if (!slug) return { ok: false, message: 'We couldn’t reach the store. Please try again.' };

  /* Generous: a real shopper places one order at a time, and a false
   * positive here blocks a sale. This is about a script, not a person. */
  if (!checkRateLimit(`place-order:${slug}:${await clientIp()}`, 12, 10 * 60 * 1000)) {
    return { ok: false, message: 'Too many attempts. Please wait a moment and try again.' };
  }

  const [config, shopper] = await Promise.all([
    getStoreCheckoutConfig({ organizationSlug: slug }),
    getShopper(),
  ]);

  const result = await placeOrder({
    organizationSlug: slug,
    customerId: shopper?.id ?? null,
    lines: Array.isArray(request.lines) ? request.lines.slice(0, 100) : [],
    contact: request.contact,
    address: request.address,
    deliveryMethodId: request.deliveryMethodId,
    paymentMethodId: request.paymentMethodId,
    note: request.note ?? '',
    discountCode: request.discountCode ?? null,
    config,
  });

  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  const { origin, pathPrefix } = await storeLocation(slug);
  const confirmationPath = confirmationPathFor(pathPrefix, result.confirmationToken);
  const method = findPaymentMethod(config, request.paymentMethodId);

  let paymentUrl: string | null = null;

  if (method?.provider === 'squad') {
    /* The order exists whatever happens next. If Squad can't be reached, the
     * shopper still lands on their confirmation, which offers "Pay now". */
    const started = await startOrderPayment({
      organizationId: result.organizationId,
      orderId: result.orderId,
      origin,
      returnPath: confirmationPath,
      nativeApp: Boolean(request.nativeApp),
    });
    paymentUrl = started.ok ? started.checkoutUrl : null;
  } else {
    // Pay on delivery and bank transfer: the order is placed now, so say so
    // (a transfer email carries the account details). An online payment gets
    // its email when the payment is verified instead.
    await notifyShopper(
      result.orderId,
      method?.id === 'transfer' ? 'placed-bank-transfer' : 'placed-pay-on-delivery',
    );
  }

  return {
    ok: true,
    reference: result.reference,
    confirmationToken: result.confirmationToken,
    paymentUrl,
    confirmationPath,
  };
}

export type PayForOrderResult = { ok: true; paymentUrl: string } | { ok: false; message: string };

const PAY_FAILURE: Record<'already-paid' | 'not-payable' | 'unavailable', string> = {
  'already-paid': 'This order is already paid — there’s nothing more to pay.',
  'not-payable': 'This order can’t be paid online. Please contact the store.',
  unavailable: 'We couldn’t open the payment page just now. Please try again in a moment.',
};

async function payFor(
  find: (organizationId: string) => Promise<{ id: string; confirmationToken: string } | null>,
  nativeApp: boolean,
): Promise<PayForOrderResult> {
  const slug = await currentStoreSlug();
  const store = slug ? await findStoreBySlug(slug) : null;
  if (!slug || !store) return { ok: false, message: 'We couldn’t reach the store. Please try again.' };

  if (!checkRateLimit(`pay-order:${store.id}:${await clientIp()}`, 10, 10 * 60 * 1000)) {
    return { ok: false, message: 'Too many attempts. Please wait a moment and try again.' };
  }

  const order = await find(store.id);
  if (!order) return { ok: false, message: 'We couldn’t find that order.' };

  const { origin, pathPrefix } = await storeLocation(slug);
  const started = await startOrderPayment({
    organizationId: store.id,
    orderId: order.id,
    origin,
    returnPath: confirmationPathFor(pathPrefix, order.confirmationToken),
    nativeApp,
  });

  return started.ok
    ? { ok: true, paymentUrl: started.checkoutUrl }
    : { ok: false, message: PAY_FAILURE[started.reason] };
}

/**
 * "Pay now" on the confirmation page — a first try that didn't start, or
 * another go after an abandoned or declined payment.
 *
 * Unlocked by the confirmation token, the same key that opens the page.
 */
export async function payForOrderAction(
  confirmationToken: string,
  options: { nativeApp?: boolean } = {},
): Promise<PayForOrderResult> {
  const token = String(confirmationToken ?? '').trim();
  return payFor(
    (organizationId) =>
      prisma.order.findFirst({
        where: { organizationId, confirmationToken: token },
        select: { id: true, confirmationToken: true },
      }),
    Boolean(options.nativeApp),
  );
}

/**
 * "Pay now" on a signed-in shopper's own order page. The order is found WITH
 * the session's customer id, so nobody can pay into — or learn about —
 * someone else's order by its reference.
 */
export async function payForMyOrderAction(
  reference: string,
  options: { nativeApp?: boolean } = {},
): Promise<PayForOrderResult> {
  const shopper = await getShopper();
  if (!shopper) return { ok: false, message: 'Sign in again to pay for this order.' };

  return payFor(
    (organizationId) =>
      organizationId === shopper.organizationId
        ? prisma.order.findFirst({
            where: { organizationId, customerId: shopper.id, reference: String(reference ?? '').trim() },
            select: { id: true, confirmationToken: true },
          })
        : Promise.resolve(null),
    Boolean(options.nativeApp),
  );
}

export type QuoteDeliveryResult =
  | { ok: true; options: ShippingMethod[]; zoneName: string | null }
  | { ok: false; message: string };

/**
 * The delivery options for an address, for checkout's delivery step.
 *
 * A preview: `subtotal` comes from the browser and only decides whether a
 * free-delivery threshold shows as met. Placing the order quotes again on the
 * server from the re-priced bag, and that quote is the one charged.
 */
export async function quoteDeliveryAction(input: {
  state: string;
  city: string;
  subtotal: number;
}): Promise<QuoteDeliveryResult> {
  const slug = await currentStoreSlug();
  if (!slug) return { ok: false, message: 'We couldn’t reach the store. Please try again.' };

  try {
    const quote = await quoteDelivery(
      slug,
      { state: String(input.state ?? '').slice(0, 80), city: String(input.city ?? '').slice(0, 120) },
      Math.max(0, Math.floor(Number(input.subtotal) || 0)),
    );
    return { ok: true, options: quote.options, zoneName: quote.zone?.name ?? null };
  } catch (error) {
    console.error('[checkout] Could not quote delivery:', error);
    return { ok: false, message: 'We couldn’t load delivery options just now. Please try again.' };
  }
}

export type ApplyDiscountResult =
  | { ok: true; coupon: AppliedCoupon }
  | { ok: false; message: string };

/**
 * "Do you have a discount code?" — checked against the merchant's own codes.
 *
 * A PREVIEW, like the delivery quote beside it: `subtotal` comes from the
 * browser, and the answer is only as good as the bag at that moment. The
 * code is checked again when the order is placed, against the re-priced bag,
 * and that check is the one that decides what is charged.
 *
 * Rate-limited, and every rejection reads the same for a code that doesn't
 * exist and one that's switched off (see ../../lib/storefront/discounts/
 * rules.ts) — otherwise this is a way to guess a store's codes.
 */
export async function applyDiscountCodeAction(input: {
  code: string;
  subtotal: number;
}): Promise<ApplyDiscountResult> {
  const slug = await currentStoreSlug();
  if (!slug) return { ok: false, message: 'We couldn’t reach the store. Please try again.' };

  const code = normalizeCode(String(input.code ?? '')).slice(0, 40);
  if (!code) return { ok: false, message: 'Enter a code.' };

  /* Tight on purpose: typing codes until one lands is the whole attack, and
   * a shopper with a code in their hand types it once. */
  if (!checkRateLimit(`discount-code:${slug}:${await clientIp()}`, 10, 10 * 60 * 1000)) {
    return { ok: false, message: 'Too many tries. Please wait a moment and try again.' };
  }

  const shopper = await getShopper();

  try {
    const result = await resolveDiscount({
      organizationSlug: slug,
      code,
      subtotal: Math.max(0, Math.floor(Number(input.subtotal) || 0)),
      customerId: shopper?.id ?? null,
    });
    return result.ok ? { ok: true, coupon: result.coupon } : { ok: false, message: result.message };
  } catch (error) {
    console.error('[checkout] Could not check a discount code:', error);
    return { ok: false, message: 'We couldn’t check that code just now. Please try again.' };
  }
}

/**
 * "Track your order" for someone without an account.
 *
 * Reference AND email, both required. A wrong email reads exactly like a
 * missing order, so this cannot be used to discover which references exist.
 */
export async function findOrderAction(input: {
  reference: string;
  email: string;
}): Promise<StorefrontOrder | null> {
  const slug = await currentStoreSlug();
  const store = slug ? await findStoreBySlug(slug) : null;
  if (!store) return null;

  if (!checkRateLimit(`find-order:${store.id}:${await clientIp()}`, 15, 10 * 60 * 1000)) {
    return null;
  }

  return findOrderByReferenceAndEmail(
    { organizationId: store.id },
    String(input.reference ?? ''),
    String(input.email ?? ''),
  );
}
