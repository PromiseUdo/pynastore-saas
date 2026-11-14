/*
 * lib/storefront/checkout/payment-methods.ts
 *
 * The ways a shopper can pay, as checkout shows them. Which of them a store
 * actually offers is decided per store by ./store-config.ts; this file only
 * says what each one is. Safe for client components.
 *
 * 'paystack' — "Pay online": Paystack's hosted page, which offers the shopper
 * card, bank transfer and whatever else the platform's Paystack account has
 * switched on. The shopper pays on Paystack's page, not ours — no card field
 * exists anywhere in the storefront, and none should. Offered only to a shop
 * that may take online payments (verified by us, subaccount active — ROADMAP
 * 10.8).
 *
 * 'pod' — pay on delivery. Nothing is charged online; the order holds its
 * stock without a time limit and the merchant records the money when the
 * courier collects it (Sales → Orders). Offered unless the merchant turned it
 * off (Organization.checkoutPayOnDelivery).
 *
 * 'transfer' — bank transfer to the merchant's own account. Offered only when
 * the store has an active bank account.
 *
 * `handoffNote` is shown once the method is picked and says what happens
 * next, in the future tense, because nothing has happened yet.
 */
import type { PaymentMethodOption } from './types';
import { TRANSFER_HOLD_HOURS } from '../orders/holds';

/** Offered first, and only to a shop that may take online payments. The money
 *  settles to the shop's own bank account through Paystack; nothing is held by
 *  the platform. */
export const ONLINE_PAYMENT_METHOD: PaymentMethodOption = {
  id: 'paystack',
  label: 'Pay online',
  description: 'Card, bank transfer or USSD, through Paystack',
  handoffNote:
    'After you place this order you’ll go to Paystack’s secure payment page to pay by card, bank transfer or USSD. No card details are entered on this site.',
  provider: 'paystack',
  settlesOnDelivery: false,
  enabled: true,
};

export const PAY_ON_DELIVERY_METHOD: PaymentMethodOption = {
  id: 'pod',
  label: 'Pay on delivery',
  description: 'Pay the courier when your order arrives',
  handoffNote:
    'Nothing is charged now. The store will confirm your order, and you pay the courier when it arrives — have the exact total ready if you’re paying cash.',
  provider: 'manual',
  settlesOnDelivery: true,
  enabled: true,
};

/** Offered last, and only to stores with at least one active bank account. */
export const BANK_TRANSFER_METHOD: PaymentMethodOption = {
  id: 'transfer',
  label: 'Bank transfer',
  description: 'Transfer the total to the store’s bank account',
  handoffNote: `After you place this order you’ll see the store’s bank details. Transfer the exact total within ${TRANSFER_HOLD_HOURS} hours and use your order number as the reference — the store confirms your order once the money arrives.`,
  provider: 'manual',
  settlesOnDelivery: false,
  enabled: true,
};
