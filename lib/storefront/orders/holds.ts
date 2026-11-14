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

/**
 * "Delivery to be arranged" (ROADMAP 21.4B): once the store has priced
 * delivery, the buyer has this long to accept it (or cancel) before the
 * order is cancelled and its stock released — as long as a transfer gets.
 */
export const ARRANGED_ACCEPT_HOURS = 48;

/** How long before the store's pricing deadline it's reminded, once. */
export const ARRANGED_REMINDER_HOURS = 4;

/** The pricing promises a store may make, in hours. */
export const ARRANGED_PRICE_HOURS = [12, 24, 48, 72] as const;
