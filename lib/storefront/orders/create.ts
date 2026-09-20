/*
 * lib/storefront/orders/create.ts
 *
 * Turning a checkout into an order — on the server, which is the point.
 *
 * WHAT THE BROWSER IS ALLOWED TO SEND: product ids, variant ids and
 * quantities. Nothing else about the goods. Prices, names, stock and totals
 * are re-resolved here from the merchant's own catalogue, because a price
 * that arrives from a browser is a price a browser can edit. The client-side
 * checks in ../checkout/checkout-service.ts catch a shopper's mistakes
 * early; these are the ones that count.
 *
 * STOCK IS HELD with the order, in the same transaction (./stock.ts): the
 * order and its hold commit together or not at all, and the hold is a
 * conditional update, so two shoppers can't both buy the last one. Unpaid
 * online-payment orders give their hold back after a while (./lifecycle.ts).
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 *   - take money. The order is written `AWAITING_PAYMENT` (or awaiting a
 *     transfer, or due on delivery) and nothing here can say PAID. Payment
 *     starts once the order exists — see ../checkout/payment-service.ts,
 *     where only a server-side verification with the provider marks it paid.
 *
 * GUESTS get a customer record all the same, found by email or created, so
 * the merchant sees a person with a history rather than a stream of
 * anonymous sales — and so a guest who later registers with that address
 * inherits their own orders (see registerShopper's "claim" note).
 */
import { randomBytes } from 'crypto';
import { Prisma } from '@/lib/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { getProductsByIds } from '../catalog';
import { normalizeEmail } from '../account/shopper';
import { calculateCheckoutTotals } from '../checkout/totals';
import { addressFromContact, countryName } from '../checkout/address';
import { findPaymentMethod } from '../checkout/config';
import { quoteDelivery } from '../delivery/quote';
import { resolveDiscount } from '../discounts/resolve';
import { cartSubtotal } from '../pricing';
import { toCartLine } from '../cart';
import { MAX_LINE_QUANTITY } from '../cart';
import { OutOfStockError, reserveOrderStock } from './stock';
import { expireUnpaidOrders } from './lifecycle';
import type { AppliedCoupon, CartItem } from '../types';
import type { CheckoutAddress, CheckoutConfig, CheckoutContact } from '../checkout/types';

/** What the browser may say about one line. */
export interface OrderLineRequest {
  productId: string;
  variantId: string;
  quantity: number;
}

export interface PlaceOrderInput {
  organizationSlug: string;
  /** set when the shopper is signed in; a guest is resolved by email */
  customerId: string | null;
  lines: OrderLineRequest[];
  contact: CheckoutContact;
  address: CheckoutAddress;
  deliveryMethodId: string;
  paymentMethodId: string;
  note: string;
  /** what the shopper typed in the bag, if anything — re-checked here */
  discountCode?: string | null;
  config: CheckoutConfig;
}

export type PlaceOrderFailure =
  | 'empty-cart'
  | 'invalid-delivery-method'
  | 'invalid-payment-method'
  | 'product-unavailable'
  | 'invalid-discount'
  | 'store-unavailable'
  | 'order-failed';

export type PlaceOrderResult =
  | { ok: true; orderId: string; organizationId: string; reference: string; confirmationToken: string }
  | { ok: false; code: PlaceOrderFailure; message: string };

const MESSAGES: Record<PlaceOrderFailure, string> = {
  'empty-cart': 'Your bag is empty.',
  'invalid-delivery-method':
    'That delivery option isn’t available for your address any more. Go back to Delivery and choose again.',
  'invalid-payment-method': 'Choose how you’d like to pay.',
  'product-unavailable':
    'Something in your bag sold out while you were checking out. Go back to your bag and we’ll show you what changed.',
  'invalid-discount':
    'Your discount code can’t be used on this order any more. Go back to your bag to remove it or try another.',
  'store-unavailable': 'This store isn’t taking orders right now.',
  'order-failed': 'We couldn’t place your order. Nothing has been charged — please try again.',
};

function fail(code: PlaceOrderFailure, message?: string): PlaceOrderResult {
  return { ok: false, code, message: message ?? MESSAGES[code] };
}

/**
 * The code ran out between the shopper applying it and this transaction.
 * Thrown inside the transaction so the order rolls back with it — an order
 * that recorded a discount it never claimed would be a discount given away
 * twice.
 */
class DiscountUnavailableError extends Error {
  constructor() {
    super('discount-unavailable');
    this.name = 'DiscountUnavailableError';
  }
}

/** Minor units (kobo) → the Decimal the database stores. */
function toMajor(minor: number): Prisma.Decimal {
  return new Prisma.Decimal(minor).dividedBy(100);
}

/**
 * The shopper-facing reference: ORD-2026-000123.
 *
 * Sequential per store per year, so a merchant reading two references knows
 * which came first — and short enough to read down a phone.
 *
 * Numbered from the HIGHEST reference issued this year, never from a count of
 * orders: a count goes backwards as soon as one order is deleted, and would
 * then keep handing out a number that is already taken. Two shoppers checking
 * out in the same instant can still compute the same number, which is why the
 * caller retries on the unique constraint, moving one further each time.
 */
async function nextReference(organizationId: string, now: Date, skip: number): Promise<string> {
  const prefix = `ORD-${now.getFullYear()}-`;

  // Zero-padded, so the text order is the numeric order.
  const latest = await prisma.order.findFirst({
    where: { organizationId, reference: { startsWith: prefix } },
    orderBy: { reference: 'desc' },
    select: { reference: true },
  });

  const last = latest ? Number.parseInt(latest.reference.slice(prefix.length), 10) || 0 : 0;
  return `${prefix}${String(last + 1 + skip).padStart(6, '0')}`;
}

/**
 * Rebuild the bag from the catalogue.
 *
 * Returns null if anything asked for is no longer sellable — a product that
 * was delisted, a variant that vanished, a line with no stock left. The
 * shopper is sent back to their bag rather than being sold something the
 * merchant can't ship.
 */
async function resolveLines(
  organizationSlug: string,
  requested: OrderLineRequest[],
): Promise<CartItem[] | null> {
  const ids = [...new Set(requested.map((line) => line.productId))];
  const products = await getProductsByIds(ids, { organizationSlug });
  const byId = new Map(products.map((product) => [product.id, product]));

  const items: CartItem[] = [];

  for (const line of requested) {
    const product = byId.get(line.productId);
    if (!product) return null;

    const variant = product.variants.find((v) => v.id === line.variantId);
    if (!variant) return null;

    const quantity = Math.floor(line.quantity);
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > MAX_LINE_QUANTITY) return null;
    if (variant.stock < quantity) return null;

    const resolved = toCartLine(product, variant.id);
    if (!resolved) return null;

    items.push({ ...resolved, quantity, addedAt: Date.now() });
  }

  return items.length > 0 ? items : null;
}

/** The customer this order belongs to: the signed-in one, or one found/made by email. */
async function resolveCustomer(input: {
  organizationId: string;
  customerId: string | null;
  contact: CheckoutContact;
}): Promise<{ id: string; isGuest: boolean } | null> {
  if (input.customerId) {
    const existing = await prisma.customer.findFirst({
      where: { id: input.customerId, organizationId: input.organizationId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (existing) return { id: existing.id, isGuest: false };
  }

  const email = normalizeEmail(input.contact.email);
  const name = `${input.contact.firstName} ${input.contact.lastName}`.trim();

  const found = await prisma.customer.findUnique({
    where: { organizationId_email: { organizationId: input.organizationId, email } },
    select: { id: true, phone: true },
  });

  if (found) {
    // Fill in a phone number the merchant didn't have; never overwrite one.
    if (!found.phone && input.contact.phone) {
      await prisma.customer.update({ where: { id: found.id }, data: { phone: input.contact.phone } });
    }
    return { id: found.id, isGuest: true };
  }

  const created = await prisma.customer.create({
    data: {
      organizationId: input.organizationId,
      name: name || email,
      email,
      phone: input.contact.phone || null,
    },
    select: { id: true },
  });

  return { id: created.id, isGuest: true };
}

/** Which payment state a method starts in. None of them is "paid". */
function initialPaymentStatus(methodId: string) {
  switch (methodId) {
    case 'transfer':
      return 'AWAITING_TRANSFER' as const;
    case 'pod':
      return 'DUE_ON_DELIVERY' as const;
    default:
      return 'AWAITING_PAYMENT' as const;
  }
}

export async function placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  const organization = await prisma.organization.findFirst({
    where: { slug: input.organizationSlug, status: 'ACTIVE' },
    select: { id: true },
  });
  if (!organization) return fail('store-unavailable');

  if (!input.lines.length) return fail('empty-cart');


  const paymentMethod = findPaymentMethod(input.config, input.paymentMethodId);
  if (!paymentMethod) return fail('invalid-payment-method');

  /* A transfer needs somewhere to send the money. The config is resolved on
   * the server per store (checkout/store-config.ts), so this is the merchant's
   * current list; it's copied onto the order below. */
  const transferDetails = paymentMethod.id === 'transfer' ? input.config.transferAccounts : null;
  if (transferDetails && transferDetails.length === 0) return fail('invalid-payment-method');

  /* Stock held by online orders nobody paid for goes back first, so a
   * shopper isn't told something sold out that is only waiting to be freed. */
  await expireUnpaidOrders({ organizationId: organization.id, limit: 5 }).catch((error) => {
    console.error('[orders] Could not expire unpaid orders:', error);
  });

  const items = await resolveLines(input.organizationSlug, input.lines);
  if (!items) return fail('product-unavailable');

  /* Delivery is quoted HERE, from the merchant's zones, for this address and
   * this re-priced bag — whatever the checkout screen showed was a preview.
   * An option that isn't offered for this address (the shopper changed it,
   * or the merchant changed their rates mid-checkout) is refused. */
  const quote = await quoteDelivery(
    input.organizationSlug,
    { state: input.address.state, city: input.address.city },
    cartSubtotal(items),
  );
  const deliveryMethod = quote.options.find((option) => option.id === input.deliveryMethodId) ?? null;
  if (!deliveryMethod) return fail('invalid-delivery-method');

  const address = addressFromContact(input.address, input.contact);
  const customer = await resolveCustomer({
    organizationId: organization.id,
    customerId: input.customerId,
    contact: input.contact,
  });
  if (!customer) return fail('order-failed');

  const now = new Date();

  /* The discount code is checked HERE, against the re-priced bag and this
   * customer's history — whatever the bag screen decided was a preview over
   * a snapshot the shopper's browser was holding. A code that has since
   * expired, run out or stopped clearing its minimum spend is refused with
   * the reason, rather than quietly dropped: someone who typed a code and is
   * charged full price without being told has been overcharged.
   *
   * Nothing is claimed yet — that happens in the transaction below. */
  let coupon: AppliedCoupon | null = null;
  let discountCodeId: string | null = null;
  const requestedCode = (input.discountCode ?? '').trim();

  if (requestedCode) {
    const resolved = await resolveDiscount({
      organizationSlug: input.organizationSlug,
      code: requestedCode,
      subtotal: cartSubtotal(items),
      customerId: customer.id,
      currency: input.config.currency,
      now,
    });
    if (!resolved.ok) return fail('invalid-discount', resolved.message);
    coupon = resolved.coupon;
    discountCodeId = resolved.recordId;
  }

  /* Totals are computed from the lines we just resolved, with the same
   * function the checkout screen used — so the figure the shopper agreed to
   * and the figure we store come from one implementation, not two. */
  const totals = calculateCheckoutTotals({ items, deliveryMethod, discount: coupon, config: input.config });

  /* Retry on the reference's unique constraint: two shoppers checking out in
   * the same second can compute the same sequence number, and the database
   * is the only thing that can settle it. */
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const reference = await nextReference(organization.id, now, attempt);
    // 256 bits: the confirmation page's only lock, since the reference beside
    // it is sequential and therefore guessable.
    const confirmationToken = randomBytes(32).toString('base64url');

    try {
      const created = await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          organizationId: organization.id,
          customerId: customer.id,
          reference,
          confirmationToken,
          status: 'PENDING',
          paymentStatus: initialPaymentStatus(paymentMethod.id),
          paymentMethod: paymentMethod.id,
          isGuest: customer.isGuest,
          transferDetails: transferDetails
            ? transferDetails.map(({ bankName, accountName, accountNumber }) => ({ bankName, accountName, accountNumber }))
            : undefined,

          email: normalizeEmail(input.contact.email),
          firstName: input.contact.firstName.trim(),
          lastName: input.contact.lastName.trim(),
          phone: input.contact.phone.trim(),

          shipFullName: `${address.firstName} ${address.lastName}`.trim(),
          shipPhone: address.phone,
          shipLine1: address.addressLine1,
          shipLine2: address.addressLine2 || null,
          shipCity: address.city,
          shipState: address.state,
          shipCountry: countryName(input.config, address.country),
          shipPostalCode: address.postalCode || null,

          deliveryMethodId: deliveryMethod.id,
          deliveryMethodLabel: deliveryMethod.label,
          deliveryFee: toMajor(totals.shipping),
          deliveryEtaMinDays: deliveryMethod.etaDays[0],
          deliveryEtaMaxDays: deliveryMethod.etaDays[1],

          currency: totals.currency,
          subtotal: toMajor(totals.subtotal),
          discount: toMajor(totals.discount),
          taxAmount: toMajor(totals.tax),
          totalAmount: toMajor(totals.total),

          discountCodeId,
          discountCode: coupon?.code ?? null,
          discountCodeLabel: coupon?.label ?? null,

          note: input.note.trim() || null,
          placedAt: now,

          lineItems: {
            create: items.map((item) => ({
              productId: item.productId,
              variantId: item.variantId,
              name: item.name,
              variantName: item.optionSummary || null,
              sku: null,
              imageUrl: item.imageUrl || null,
              slug: item.productSlug,
              quantity: item.quantity,
              unitPrice: toMajor(item.unitPrice),
              totalPrice: toMajor(item.unitPrice * item.quantity),
            })),
          },
        },
        select: { id: true, lineItems: { select: { id: true, variantId: true, quantity: true } } },
      });

      /* One order, one use. A conditional update, in the order's own
       * transaction: two shoppers racing for the last use of a limited code
       * cannot both get it, and if this loses the whole order rolls back. */
      if (discountCodeId) {
        const limit = await tx.discountCode.findFirst({
          where: { id: discountCodeId, organizationId: organization.id, isActive: true },
          select: { usageLimit: true },
        });
        if (!limit) throw new DiscountUnavailableError();

        const claimed = await tx.discountCode.updateMany({
          where: {
            id: discountCodeId,
            organizationId: organization.id,
            ...(limit.usageLimit !== null ? { usageCount: { lt: limit.usageLimit } } : {}),
          },
          data: { usageCount: { increment: 1 } },
        });
        if (!claimed.count) throw new DiscountUnavailableError();
      }

      await reserveOrderStock(tx, {
        organizationId: organization.id,
        orderId: order.id,
        lines: order.lineItems.map((line) => ({
          orderLineItemId: line.id,
          inventoryItemId: line.variantId!,
          quantity: line.quantity,
        })),
      });

      return order;
      },
      /* Several round trips (the order, its lines, a hold per store per line)
       * to a database that may be a region away: Prisma's 5s default is too
       * tight for a bag of a few lines on a slow day. */
      { timeout: 20_000, maxWait: 10_000 });

      return { ok: true, orderId: created.id, organizationId: organization.id, reference, confirmationToken };
    } catch (error) {
      // Sold out between the catalogue read and the hold: the order rolled back.
      if (error instanceof OutOfStockError) return fail('product-unavailable');
      // Someone else took the last use of the code in the meantime.
      if (error instanceof DiscountUnavailableError) {
        return fail(
          'invalid-discount',
          'That discount code has just been fully claimed. Go back to your bag to remove it — nothing has been charged.',
        );
      }
      const clash =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
      if (!clash) {
        console.error('[orders] Could not place order:', error);
        return fail('order-failed');
      }
    }
  }

  console.error(`[orders] Could not find a free order reference for store ${organization.id} after 5 attempts.`);
  return fail('order-failed');
}
