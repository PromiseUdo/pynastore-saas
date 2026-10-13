/*
 * lib/notifications/events.ts
 *
 * Every kind of notification, in one place (ROADMAP 18). Pure.
 *
 * Each kind says:
 *   - who it is for (`audiences`, resolved by ./recipients.ts);
 *   - the preference category a person turns it on or off with;
 *   - which channels it may use and whether each is on by default — a
 *     channel that isn't listed is never used, and a `required` one can't
 *     be turned off;
 *   - its words, for the in-app list and for a phone or browser;
 *   - what it's about (a typed target, turned into links by ./links.ts);
 *   - the thread it belongs to, so a burst collapses into one.
 *
 * The words of a shopper's chat notification never include the message
 * (17.4): a lock screen is not a private place.
 */
import type { NotificationChannel } from '@/lib/generated/prisma/enums';
import type { OrderEmailKind } from '@/emails/storefront-order-update';
import type { StoreOrderAlertKind } from '@/emails/store-order-alert';
import { PERMISSIONS, type PermissionKey } from '@/lib/permissions';
import { orderPushMessage } from '@/lib/mobile/push/messages';
import type { NotificationTarget } from './links';

export const NOTIFICATION_CATEGORIES = {
  orders: 'Orders',
  messages: 'Messages',
  stock: 'Stock',
  payments: 'Payments',
  operations: 'Platform operations',
} as const;

export type NotificationCategory = keyof typeof NOTIFICATION_CATEGORIES;

export type Audience =
  /** active members holding `permission`, plus the Owner when `owner` */
  | { type: 'staff'; permission: PermissionKey; owner: boolean }
  /** whoever placed the order: their account, or the address on a guest order, and phones watching it */
  | { type: 'order-shopper'; orderId: string }
  /** the shopper in a conversation: their account, or a guest's browsers, and phones watching it */
  | { type: 'chat-shopper'; conversationId: string }
  /** platform staff */
  | { type: 'platform' };

export type ChannelDefault = 'on' | 'off' | 'required';

export interface NotificationWords {
  title: string;
  body: string;
}

/** What each kind needs to be told about. */
export interface EventFacts {
  'order.update': {
    kind: OrderEmailKind;
    orderId: string;
    reference: string;
    confirmationToken: string | null;
    returnId?: string;
    storeName: string;
  };
  'order.alert': { kind: StoreOrderAlertKind; orderId: string; reference: string; returnId?: string; customerName: string };
  'chat.message': { conversationId: string; shopperName: string | null };
  'chat.reply': { conversationId: string; storeName: string };
  'stock.low': { warehouseId: string; warehouseName: string; itemName: string; quantity: number };
  'payment.dispute': { kind: 'opened' | 'resolved'; orderId: string; reference: string; amount: string };
  /** something broken on the platform: a job, a webhook, an error (lib/ops/alerts.ts) */
  'platform.alert': { heading: string; path: string };
  'platform.domain-order': { shopName: string; domain: string; type: 'EXISTING' | 'REGISTER' | 'RENEW' };
  'platform.mobile-app-paid': { appOrderId: string; shopName: string; appName: string };
}

export type NotificationKind = keyof EventFacts;

export interface EventDefinition<F> {
  category: NotificationCategory;
  audiences: (facts: F) => Audience[];
  channels: Partial<Record<NotificationChannel, ChannelDefault>>;
  words: (facts: F) => NotificationWords;
  /** whether this one goes to phones and browsers at all (default: yes) */
  pushes?: (facts: F) => boolean;
  target: (facts: F) => NotificationTarget;
  thread?: (facts: F) => string;
}

type Catalogue = { [K in NotificationKind]: EventDefinition<EventFacts[K]> };

/** The list's words for an order update; a phone gets orderPushMessage's where it has one. */
const ORDER_LIST_LINES: Record<OrderEmailKind, (reference: string) => string> = {
  'placed-pay-on-delivery': (ref) => `Order ${ref} was placed. You’ll pay when it arrives.`,
  'placed-bank-transfer': (ref) => `Order ${ref} was placed and is waiting for your transfer.`,
  'payment-received': (ref) => `Payment received for order ${ref}.`,
  shipped: (ref) => `Order ${ref} is on its way.`,
  delivered: (ref) => `Order ${ref} has been delivered.`,
  cancelled: (ref) => `Order ${ref} was cancelled by the store.`,
  'cancelled-by-you': (ref) => `You cancelled order ${ref}.`,
  'payment-timeout': (ref) => `Order ${ref} was cancelled — we didn’t receive the payment in time.`,
  'return-requested': (ref) => `You asked to return items from order ${ref}.`,
  'return-approved': (ref) => `Your return for order ${ref} was approved.`,
  'return-rejected': (ref) => `The store replied to your return request for order ${ref}.`,
  refunded: (ref) => `A refund for order ${ref} has been recorded.`,
};

const orderThread = (facts: { orderId: string }) => `order:${facts.orderId}`;

export const EVENTS: Catalogue = {
  'order.update': {
    category: 'orders',
    audiences: (f) => [{ type: 'order-shopper', orderId: f.orderId }],
    channels: { EMAIL: 'on', NATIVE_PUSH: 'on', WEB_PUSH: 'on' },
    words: (f) =>
      orderPushMessage(f.kind, { storeName: f.storeName, reference: f.reference }) ?? {
        title: f.storeName,
        body: ORDER_LIST_LINES[f.kind](f.reference),
      },
    // Only changes the shopper didn't make themselves (lib/mobile/push/messages.ts).
    pushes: (f) => orderPushMessage(f.kind, { storeName: f.storeName, reference: f.reference }) !== null,
    target: (f) =>
      f.returnId
        ? { type: 'return', returnId: f.returnId, orderId: f.orderId, reference: f.reference, confirmationToken: f.confirmationToken }
        : { type: 'order', orderId: f.orderId, reference: f.reference, confirmationToken: f.confirmationToken },
    thread: orderThread,
  },
  'order.alert': {
    category: 'orders',
    audiences: (f) => [
      {
        type: 'staff',
        permission: f.kind === 'customer-cancelled' ? PERMISSIONS.SALES_FULFILLMENT_MANAGE : PERMISSIONS.SALES_RETURN_MANAGE,
        owner: true,
      },
    ],
    channels: { EMAIL: 'on', WEB_PUSH: 'on', NATIVE_PUSH: 'on' },
    words: (f) =>
      f.kind === 'customer-cancelled'
        ? { title: `Order ${f.reference} cancelled`, body: `${f.customerName} cancelled their order.` }
        : { title: `Return requested on order ${f.reference}`, body: `${f.customerName} asked to return items.` },
    target: (f) =>
      f.returnId
        ? { type: 'return', returnId: f.returnId, orderId: f.orderId, reference: f.reference }
        : { type: 'order', orderId: f.orderId, reference: f.reference },
    thread: orderThread,
  },
  'chat.message': {
    category: 'messages',
    audiences: () => [{ type: 'staff', permission: PERMISSIONS.MESSAGES_REPLY, owner: true }],
    channels: { EMAIL: 'on', WEB_PUSH: 'on', NATIVE_PUSH: 'on' },
    words: (f) => ({ title: 'New message', body: `${f.shopperName ?? 'A guest'} is waiting for a reply.` }),
    target: (f) => ({ type: 'conversation', conversationId: f.conversationId }),
    thread: (f) => `chat:${f.conversationId}`,
  },
  'chat.reply': {
    category: 'messages',
    audiences: (f) => [{ type: 'chat-shopper', conversationId: f.conversationId }],
    channels: { NATIVE_PUSH: 'on', WEB_PUSH: 'on' },
    words: (f) => ({ title: f.storeName, body: 'The store replied to your message.' }),
    target: (f) => ({ type: 'conversation', conversationId: f.conversationId }),
    thread: (f) => `chat:${f.conversationId}`,
  },
  'stock.low': {
    category: 'stock',
    // As the email always went: whoever can add stock. Not the Owner by role alone.
    audiences: () => [{ type: 'staff', permission: PERMISSIONS.INVENTORY_CREATE, owner: false }],
    channels: { EMAIL: 'on', WEB_PUSH: 'off', NATIVE_PUSH: 'off' },
    words: (f) => ({ title: `Low stock: ${f.itemName}`, body: `${f.quantity} left at ${f.warehouseName}.` }),
    target: (f) => ({ type: 'low-stock', warehouseId: f.warehouseId }),
    thread: (f) => `lowstock:${f.warehouseId}`,
  },
  'payment.dispute': {
    category: 'payments',
    audiences: () => [{ type: 'staff', permission: PERMISSIONS.SALES_FULFILLMENT_MANAGE, owner: true }, { type: 'platform' }],
    channels: { EMAIL: 'required', WEB_PUSH: 'on', NATIVE_PUSH: 'on' },
    words: (f) =>
      f.kind === 'opened'
        ? { title: `Payment dispute on order ${f.reference}`, body: `The customer’s bank is disputing ${f.amount}.` }
        : { title: `Dispute settled on order ${f.reference}`, body: `The dispute over ${f.amount} has been settled.` },
    target: (f) => ({ type: 'dispute', orderId: f.orderId, reference: f.reference }),
    thread: orderThread,
  },
  'platform.alert': {
    category: 'operations',
    audiences: () => [{ type: 'platform' }],
    channels: { EMAIL: 'on', WEB_PUSH: 'on' },
    words: (f) => ({ title: 'Platform alert', body: f.heading }),
    target: (f) => ({ type: 'platform', path: f.path }),
  },
  'platform.domain-order': {
    category: 'operations',
    audiences: () => [{ type: 'platform' }],
    channels: { EMAIL: 'on', WEB_PUSH: 'on' },
    words: (f) => ({ title: `New domain order: ${f.domain}`, body: `${f.shopName} is waiting for their domain.` }),
    target: () => ({ type: 'platform', path: '/platform/domains' }),
  },
  'platform.mobile-app-paid': {
    category: 'operations',
    audiences: () => [{ type: 'platform' }],
    channels: { EMAIL: 'on', WEB_PUSH: 'on' },
    words: (f) => ({ title: `Store app paid: ${f.appName}`, body: `${f.shopName} paid for their app. It’s ready to build.` }),
    target: (f) => ({ type: 'platform', path: `/platform/mobile-apps/${f.appOrderId}` }),
  },
};

export function eventDefinition<K extends NotificationKind>(kind: K): EventDefinition<EventFacts[K]> {
  return EVENTS[kind] as EventDefinition<EventFacts[K]>;
}
