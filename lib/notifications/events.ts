/*
 * lib/notifications/events.ts
 *
 * Every kind of notification, in one place (ROADMAP 18). Pure.
 *
 * Each kind says:
 *   - who it is for (`audiences`, resolved by ./recipients.ts);
 *   - the preference category a person turns it on or off with, and who it
 *     can reach (`reaches`), which decides whose preferences show it;
 *   - which channels it may use and whether each is on by default — a
 *     channel that isn't listed is never used, a `required` one can't be
 *     turned off, and a `digest` email is gathered into one a day
 *     (./digest.ts) instead of sent at once;
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

/** Each category's name and what it covers, as the preferences show them. */
export const NOTIFICATION_CATEGORIES = {
  orders: { label: 'Orders', about: 'New orders, transfers to confirm, cancellations and returns — or, for a shopper, where their order has got to.' },
  messages: { label: 'Messages', about: 'Chat messages waiting for a reply — or, for a shopper, the store’s replies.' },
  questions: { label: 'Product questions', about: 'Questions shoppers ask on products, waiting for an answer.' },
  stock: { label: 'Low stock', about: 'Products at or below their reorder point in a store you can work in.' },
  purchasing: { label: 'Purchasing', about: 'Purchase orders waiting for approval.' },
  payments: { label: 'Payment disputes', about: 'A customer’s bank disputing a payment, and how it ended.' },
  account: { label: 'Your shop’s account', about: 'Your trial ending, and your domain and store app.' },
  social: { label: 'Social posts', about: 'A post that failed to publish.' },
  merchants: { label: 'Merchants', about: 'New shops, and verification waiting for review.' },
  operations: { label: 'Platform operations', about: 'Broken jobs and webhooks, error spikes, domain and app orders.' },
} as const;

export type NotificationCategory = keyof typeof NOTIFICATION_CATEGORIES;

export type Audience =
  /**
   * active members holding `permission`, plus the Owner when `owner`; with
   * `warehouseId`, only those who can work in that store (8.6)
   */
  | { type: 'staff'; permission: PermissionKey; owner: boolean; warehouseId?: string }
  /** whoever placed the order: their account, or the address on a guest order, and phones watching it */
  | { type: 'order-shopper'; orderId: string }
  /** the shopper in a conversation: their account, or a guest's browsers, and phones watching it */
  | { type: 'chat-shopper'; conversationId: string }
  /** platform staff */
  | { type: 'platform' };

export type ChannelDefault = 'on' | 'off' | 'required' | 'digest';

/** Who a kind can reach, for preferences; staff only with `permission` (the Owner always). */
export interface Reaches {
  staff?: PermissionKey;
  shopper?: true;
  platform?: true;
}

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
  /** `unread`: the store's messages they haven't read yet, this one included */
  'chat.reply': { conversationId: string; storeName: string; unread: number };
  'stock.low': {
    warehouseId: string;
    warehouseName: string;
    itemName: string;
    quantity: number;
    reorderPoint: number;
    /** whose reorder point was crossed: the store's own, or the product's */
    thresholdSource: 'store' | 'product';
  };
  'payment.dispute': { kind: 'opened' | 'resolved'; orderId: string; reference: string; amount: string };
  /** something broken on the platform: a job, a webhook, an error (lib/ops/alerts.ts) */
  'platform.alert': { heading: string; path: string };
  'platform.domain-order': { shopName: string; domain: string; type: 'EXISTING' | 'REGISTER' | 'RENEW' };
  'platform.mobile-app-paid': { appOrderId: string; shopName: string; appName: string };
  /** an online order that needs the store: paid online, or to be paid on delivery */
  'order.new': { orderId: string; reference: string; customerName: string; total: string; payment: 'paid' | 'on-delivery' };
  /** an order to be paid by bank transfer, waiting for the store to confirm the money */
  'order.transfer': { orderId: string; reference: string; customerName: string; total: string };
  'question.new': { productName: string; shopperName: string };
  'purchasing.approval': { purchaseOrderId: string; number: string; supplierName: string };
  /** an email the shop's owners already got (trial, domain, store app), in their list too */
  'account.notice': { title: string; body: string; path: string };
  'social.failed': { postId: string; productName: string | null; platform: string };
  'platform.merchant-new': { organizationId: string; shopName: string };
  'platform.verification': { shopName: string };
}

export type NotificationKind = keyof EventFacts;

export interface EventDefinition<F> {
  category: NotificationCategory;
  reaches: Reaches;
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
    reaches: { shopper: true },
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
    reaches: { staff: PERMISSIONS.SALES_FULFILLMENT_MANAGE },
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
    reaches: { staff: PERMISSIONS.MESSAGES_REPLY },
    audiences: () => [{ type: 'staff', permission: PERMISSIONS.MESSAGES_REPLY, owner: true }],
    channels: { EMAIL: 'on', WEB_PUSH: 'on', NATIVE_PUSH: 'on' },
    words: (f) => ({ title: 'New message', body: `${f.shopperName ?? 'A guest'} is waiting for a reply.` }),
    target: (f) => ({ type: 'conversation', conversationId: f.conversationId }),
    thread: (f) => `chat:${f.conversationId}`,
  },
  'chat.reply': {
    category: 'messages',
    reaches: { shopper: true },
    audiences: (f) => [{ type: 'chat-shopper', conversationId: f.conversationId }],
    channels: { NATIVE_PUSH: 'on', WEB_PUSH: 'on' },
    // Never the message itself: a lock screen is not a private place.
    words: (f) => ({
      title: f.storeName,
      body: f.unread > 1 ? `The store sent you ${f.unread} new messages.` : 'The store replied to your message.',
    }),
    target: (f) => ({ type: 'conversation', conversationId: f.conversationId }),
    thread: (f) => `chat:${f.conversationId}`,
  },
  'stock.low': {
    category: 'stock',
    reaches: { staff: PERMISSIONS.INVENTORY_VIEW },
    // Whoever can see stock and work in that store (8.6), the Owner too; one email a day, not one per item.
    audiences: (f) => [{ type: 'staff', permission: PERMISSIONS.INVENTORY_VIEW, owner: true, warehouseId: f.warehouseId }],
    channels: { EMAIL: 'digest', WEB_PUSH: 'off', NATIVE_PUSH: 'off' },
    words: (f) => ({
      title: `Low stock: ${f.itemName}`,
      body: `${f.quantity} left at ${f.warehouseName} — ${
        f.thresholdSource === 'store' ? `${f.warehouseName}’s own reorder point is ${f.reorderPoint}` : `the product’s reorder point is ${f.reorderPoint}`
      }.`,
    }),
    target: (f) => ({ type: 'low-stock', warehouseId: f.warehouseId }),
    thread: (f) => `lowstock:${f.warehouseId}`,
  },
  'payment.dispute': {
    category: 'payments',
    reaches: { staff: PERMISSIONS.SALES_FULFILLMENT_MANAGE, platform: true },
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
    reaches: { platform: true },
    audiences: () => [{ type: 'platform' }],
    channels: { EMAIL: 'on', WEB_PUSH: 'on' },
    words: (f) => ({ title: 'Platform alert', body: f.heading }),
    target: (f) => ({ type: 'platform', path: f.path }),
  },
  'platform.domain-order': {
    category: 'operations',
    reaches: { platform: true },
    audiences: () => [{ type: 'platform' }],
    channels: { EMAIL: 'on', WEB_PUSH: 'on' },
    words: (f) => ({ title: `New domain order: ${f.domain}`, body: `${f.shopName} is waiting for their domain.` }),
    target: () => ({ type: 'platform', path: '/platform/domains' }),
  },
  'platform.mobile-app-paid': {
    category: 'operations',
    reaches: { platform: true },
    audiences: () => [{ type: 'platform' }],
    channels: { EMAIL: 'on', WEB_PUSH: 'on' },
    words: (f) => ({ title: `Store app paid: ${f.appName}`, body: `${f.shopName} paid for their app. It’s ready to build.` }),
    target: (f) => ({ type: 'platform', path: `/platform/mobile-apps/${f.appOrderId}` }),
  },
  'order.new': {
    category: 'orders',
    reaches: { staff: PERMISSIONS.SALES_FULFILLMENT_MANAGE },
    audiences: () => [{ type: 'staff', permission: PERMISSIONS.SALES_FULFILLMENT_MANAGE, owner: true }],
    channels: { WEB_PUSH: 'on', NATIVE_PUSH: 'on' },
    words: (f) => ({
      title: `New order ${f.reference}`,
      body: `${f.customerName} · ${f.total} · ${f.payment === 'paid' ? 'paid online' : 'pay on delivery'}`,
    }),
    target: (f) => ({ type: 'order', orderId: f.orderId, reference: f.reference }),
    thread: orderThread,
  },
  'order.transfer': {
    category: 'orders',
    reaches: { staff: PERMISSIONS.SALES_FULFILLMENT_MANAGE },
    audiences: () => [{ type: 'staff', permission: PERMISSIONS.SALES_FULFILLMENT_MANAGE, owner: true }],
    channels: { WEB_PUSH: 'on', NATIVE_PUSH: 'on' },
    words: (f) => ({
      title: `Transfer to confirm: order ${f.reference}`,
      body: `${f.customerName} will pay ${f.total} by bank transfer. Confirm it when the money arrives.`,
    }),
    target: (f) => ({ type: 'order', orderId: f.orderId, reference: f.reference }),
    thread: orderThread,
  },
  'question.new': {
    category: 'questions',
    reaches: { staff: PERMISSIONS.SALES_QUESTION_ANSWER },
    audiences: () => [{ type: 'staff', permission: PERMISSIONS.SALES_QUESTION_ANSWER, owner: true }],
    channels: { EMAIL: 'digest', WEB_PUSH: 'off', NATIVE_PUSH: 'off' },
    words: (f) => ({ title: `New question on ${f.productName}`, body: `${f.shopperName} is waiting for an answer.` }),
    target: () => ({ type: 'questions' }),
    thread: () => 'questions',
  },
  'purchasing.approval': {
    category: 'purchasing',
    reaches: { staff: PERMISSIONS.PROCUREMENT_APPROVE },
    audiences: () => [{ type: 'staff', permission: PERMISSIONS.PROCUREMENT_APPROVE, owner: true }],
    channels: { WEB_PUSH: 'on', NATIVE_PUSH: 'on' },
    words: (f) => ({ title: `Purchase order ${f.number} needs approval`, body: `From ${f.supplierName}.` }),
    target: (f) => ({ type: 'purchase-order', purchaseOrderId: f.purchaseOrderId }),
    thread: (f) => `po:${f.purchaseOrderId}`,
  },
  'account.notice': {
    category: 'account',
    reaches: { staff: PERMISSIONS.BILLING_MANAGE },
    audiences: () => [{ type: 'staff', permission: PERMISSIONS.BILLING_MANAGE, owner: true }],
    // The email is sent where it always was (the trial, domain and app jobs); it can't be turned off.
    channels: { EMAIL: 'required', WEB_PUSH: 'on', NATIVE_PUSH: 'on' },
    words: (f) => ({ title: f.title, body: f.body }),
    target: (f) => ({ type: 'admin-page', path: f.path }),
  },
  'social.failed': {
    category: 'social',
    reaches: { staff: PERMISSIONS.SOCIAL_MANAGE },
    audiences: () => [{ type: 'staff', permission: PERMISSIONS.SOCIAL_MANAGE, owner: true }],
    // The list only: the person who pressed Publish saw it fail on screen.
    channels: {},
    words: (f) => ({
      title: `A ${f.platform} post didn’t publish`,
      body: f.productName ? `The post about ${f.productName} can be tried again from Post history.` : 'It can be tried again from Post history.',
    }),
    target: (f) => ({ type: 'social-post', postId: f.postId }),
  },
  'platform.merchant-new': {
    category: 'merchants',
    reaches: { platform: true },
    audiences: () => [{ type: 'platform' }],
    channels: { WEB_PUSH: 'on' },
    words: (f) => ({ title: 'New shop', body: `${f.shopName} just signed up.` }),
    target: (f) => ({ type: 'platform', path: `/platform/merchants/${f.organizationId}` }),
  },
  'platform.verification': {
    category: 'merchants',
    reaches: { platform: true },
    audiences: () => [{ type: 'platform' }],
    channels: { WEB_PUSH: 'on' },
    words: (f) => ({ title: 'Verification to review', body: `${f.shopName} sent their business details.` }),
    target: () => ({ type: 'platform', path: '/platform/verification' }),
  },
};

export function eventDefinition<K extends NotificationKind>(kind: K): EventDefinition<EventFacts[K]> {
  return EVENTS[kind] as EventDefinition<EventFacts[K]>;
}
