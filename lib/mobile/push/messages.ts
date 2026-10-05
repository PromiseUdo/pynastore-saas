/*
 * lib/mobile/push/messages.ts
 *
 * What a push notification about an order says (ROADMAP 16.4). Pure.
 *
 * Only for changes the shopper didn't make themselves and would want to know
 * about straight away. Placing an order, cancelling it, or asking for a
 * return are things they just did — the email covers those. Every line
 * restates what the order's status now IS; none promises anything the store
 * hasn't done.
 */
import type { OrderEmailKind } from '@/emails/storefront-order-update';

export interface PushMessage {
  title: string;
  body: string;
}

const LINES: Partial<Record<OrderEmailKind, (reference: string) => string>> = {
  'payment-received': (ref) => `Payment received for order ${ref}.`,
  shipped: (ref) => `Order ${ref} is on its way.`,
  delivered: (ref) => `Order ${ref} has been delivered.`,
  cancelled: (ref) => `Order ${ref} was cancelled by the store.`,
  'payment-timeout': (ref) => `Order ${ref} was cancelled — we didn’t receive the payment in time.`,
  'return-approved': (ref) => `Your return for order ${ref} was approved.`,
  'return-rejected': (ref) => `The store replied to your return request for order ${ref}.`,
  refunded: (ref) => `A refund for order ${ref} has been recorded.`,
};

export function orderPushMessage(
  kind: OrderEmailKind,
  input: { storeName: string; reference: string },
): PushMessage | null {
  const line = LINES[kind];
  return line ? { title: input.storeName, body: line(input.reference) } : null;
}

/** Device tokens as the platforms issue them; anything else is refused before it's stored. */
export function isPlausiblePushToken(platform: 'ANDROID' | 'IOS', token: string): boolean {
  if (platform === 'IOS') return /^[0-9a-f]{64,200}$/i.test(token);
  return token.length >= 20 && token.length <= 4096 && /^[A-Za-z0-9_:\-.]+$/.test(token);
}
