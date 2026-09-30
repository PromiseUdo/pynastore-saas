/*
 * lib/storefront/orders/holds.ts
 *
 * How long an unpaid order keeps its stock held — the one place these are
 * set (ROADMAP 12.4; the transfer hold used to live in the demo checkout
 * fixtures). Pure and client-safe: the checkout, the order page, the
 * shopper's transfer instructions, emails and the expiry job all read them.
 */

/** An online-payment order that hasn't been paid is cancelled after this long. */
export const UNPAID_ORDER_HOLD_MINUTES = 60;

/** A bank-transfer order waits this long for the money before it's cancelled unpaid. */
export const TRANSFER_HOLD_HOURS = 48;
