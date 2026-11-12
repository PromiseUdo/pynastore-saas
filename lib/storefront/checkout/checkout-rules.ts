/*
 * lib/storefront/checkout/checkout-rules.ts
 *
 * The one rule about a merchant's checkout choices that needs saying twice —
 * when they try to turn pay on delivery off, and on Settings → Payments: a
 * shop must leave shoppers at least one way to pay. Pure, so it is tested
 * without a database.
 */

export interface WaysToPay {
  /** the merchant's "Pay on delivery" switch */
  payOnDelivery: boolean;
  /** online payments are ready (verified, subaccount active, not suspended) */
  onlineReady: boolean;
  /** active bank accounts behind "Bank transfer" */
  activeBankAccounts: number;
}

/** Whether checkout offers a shopper anything to pay with. */
export function shopperCanPay(ways: WaysToPay): boolean {
  return ways.payOnDelivery || ways.onlineReady || ways.activeBankAccounts > 0;
}

export const LAST_WAY_TO_PAY_MESSAGE =
  'Pay on delivery is the only way shoppers can pay you right now. Add a bank account or finish Get paid online before turning it off.';
