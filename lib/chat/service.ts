/*
 * lib/chat/service.ts
 *
 * THE tenant boundary for Messages (ROADMAP 17). Every read and every write
 * goes through here, and every function takes `organizationId` first — from
 * getOrganizationContext() in the admin, from resolveRequestStore on the
 * storefront — never from a form.
 *
 * The rules this file exists to enforce:
 *
 *   1. A conversation is reached by its id AND its organizationId, always.
 *      Another store's id is "not found", not someone else's customer.
 *   2. A shopper never names a conversation. Theirs is found from who they
 *      are (./identity.ts) — one per shopper per store — so there is no id
 *      for a shopper to swap.
 *   3. Messages are numbered (`seq`) inside the send transaction, from the
 *      conversation's own `lastSeq`. Two sends at once queue on that row and
 *      get consecutive numbers; a retried `clientId` saves once.
 *   4. What leaves for a shopper is ShopperChatMessage, which has no staff
 *      field — a team member's name can't reach a shopper by accident.
 *
 * Audit entries for resolve/reopen/block are written by the admin actions
 * that call this (17.2), which hold the member's session; this file holds the
 * data rules. Rate limits on sending (17.5) sit in front of it, likewise.
 */
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/lib/generated/prisma/client';
import { storefrontIsOpen } from '@/lib/billing/workspace-access';
import { notifyChatChanged } from './realtime';
import type { ChatIdentity } from './identity';
import {
  CHAT_STORE_AUTHOR,
  CONVERSATION_PAGE_SIZE,
  MESSAGE_PAGE_SIZE,
  isAwaitingReply,
  isValidClientId,
  normalizeGuestName,
  previewOf,
  unreadCount,
  validateMessage,
  type ChatConversationStatus,
  type ChatSender,
  type InboxView,
  type ShopperChatMessage,
  type StaffChatMessage,
} from './rules';

/** A poll that has fallen far behind gets this many, then asks again. */
const MAX_MESSAGES_AFTER = 200;
/** The inbox's "someone is looking" mark is written at most this often. */
const INBOX_SEEN_THROTTLE_MS = 60_000;
/** The shopper's "has it open" mark, likewise — the reply push waits 30s on it. */
const CUSTOMER_SEEN_THROTTLE_MS = 20_000;

/* ─── Is chat on? ───────────────────────────────────────────────────────── */

export interface ChatAvailability {
  /** shoppers may send: chat on, shop open, billing not closed */
  open: boolean;
  /** the merchant's own greeting, or null for the interface's line */
  greeting: string | null;
}

/**
 * Whether this store takes messages right now. Every shopper send re-checks
 * it; the storefront uses it to decide whether to show the chat at all.
 */
export async function chatAvailability(organizationId: string): Promise<ChatAvailability> {
  const org = await prisma.organization.findFirst({
    where: { id: organizationId, status: 'ACTIVE' },
    select: { storefrontChatEnabled: true, storefrontChatGreeting: true, storefrontOpen: true },
  });
  if (!org || !org.storefrontChatEnabled || !org.storefrontOpen) {
    return { open: false, greeting: org?.storefrontChatGreeting ?? null };
  }
  return { open: await storefrontIsOpen(organizationId), greeting: org.storefrontChatGreeting };
}

/**
 * For the merchant's Messages page: why shoppers might not be able to write
 * — chat switched off, or the whole shop closed.
 */
export async function chatSetup(organizationId: string): Promise<{ enabled: boolean; shopOpen: boolean }> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { storefrontChatEnabled: true, storefrontOpen: true },
  });
  return { enabled: org?.storefrontChatEnabled ?? false, shopOpen: org?.storefrontOpen ?? false };
}

/* ─── Shared ────────────────────────────────────────────────────────────── */

function whereShopper(organizationId: string, identity: ChatIdentity): Prisma.ChatConversationWhereUniqueInput {
  return identity.kind === 'customer'
    ? { organizationId_customerId: { organizationId, customerId: identity.customerId } }
    : { organizationId_guestKeyHash: { organizationId, guestKeyHash: identity.guestKeyHash } };
}

const SHOPPER_MESSAGE_SELECT = {
  id: true,
  seq: true,
  sender: true,
  body: true,
  productId: true,
  clientId: true,
  createdAt: true,
} satisfies Prisma.ChatMessageSelect;

const STAFF_MESSAGE_SELECT = {
  ...SHOPPER_MESSAGE_SELECT,
  staffUserId: true,
  staffUser: { select: { name: true, email: true } },
} satisfies Prisma.ChatMessageSelect;

type ShopperMessageRow = Prisma.ChatMessageGetPayload<{ select: typeof SHOPPER_MESSAGE_SELECT }>;
type StaffMessageRow = Prisma.ChatMessageGetPayload<{ select: typeof STAFF_MESSAGE_SELECT }>;

function toShopperMessage(m: ShopperMessageRow): ShopperChatMessage {
  return {
    id: m.id,
    seq: m.seq,
    sender: m.sender,
    author: m.sender === 'STAFF' ? CHAT_STORE_AUTHOR : null,
    body: m.body,
    productId: m.productId,
    clientId: m.clientId,
    createdAt: m.createdAt.toISOString(),
  };
}

function toStaffMessage(m: StaffMessageRow): StaffChatMessage {
  return {
    id: m.id,
    seq: m.seq,
    sender: m.sender,
    staffUserId: m.staffUserId,
    staffName: m.staffUser ? m.staffUser.name?.trim() || m.staffUser.email : null,
    body: m.body,
    productId: m.productId,
    clientId: m.clientId,
    createdAt: m.createdAt.toISOString(),
  };
}

export interface MessageWindow {
  /** messages with a seq greater than this (a poll) */
  after?: number;
  /** messages with a seq less than this ("Load earlier") */
  before?: number;
}

/**
 * One page of a conversation, oldest first. With `after`, everything newer
 * (up to a cap); otherwise the latest page, or the page before `before`.
 * `hasEarlier` is only known for the second kind. Returns the query to run
 * and how to finish its rows, so each caller keeps its own select's types.
 */
function messagePage(organizationId: string, conversationId: string, window: MessageWindow) {
  const base = { organizationId, conversationId };
  if (window.after !== undefined) {
    return {
      args: {
        where: { ...base, seq: { gt: Math.max(0, Math.floor(window.after)) } },
        orderBy: { seq: 'asc' as const },
        take: MAX_MESSAGES_AFTER,
      },
      finish: <T>(rows: T[]) => ({ rows, hasEarlier: null as boolean | null }),
    };
  }
  return {
    args: {
      where: { ...base, ...(window.before !== undefined ? { seq: { lt: Math.floor(window.before) } } : {}) },
      orderBy: { seq: 'desc' as const },
      take: MESSAGE_PAGE_SIZE + 1,
    },
    finish: <T>(rows: T[]) => ({
      rows: rows.slice(0, MESSAGE_PAGE_SIZE).reverse(),
      hasEarlier: (rows.length > MESSAGE_PAGE_SIZE) as boolean | null,
    }),
  };
}

/** Prisma's unique-constraint error, whatever adapter raised it. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

class ChatBlockedError extends Error {}

export type SendFailure = 'invalid' | 'unavailable' | 'blocked' | 'not-found' | 'failed';

export type SendResult<M> =
  | { ok: true; message: M; conversationId: string }
  | { ok: false; code: SendFailure; message: string };

const FAILED = { ok: false, code: 'failed', message: 'Your message wasn’t sent. Please try again.' } as const;

/* ─── The shopper's side ────────────────────────────────────────────────── */

export interface ShopperChat {
  conversation: {
    id: string;
    status: ChatConversationStatus;
    /** store messages the shopper hasn't seen */
    unread: number;
    blocked: boolean;
  } | null;
  messages: ShopperChatMessage[];
  hasEarlier: boolean | null;
}

/** Whether this shopper has a conversation with the store yet (for the new-guest limit). */
export async function hasShopperConversation(organizationId: string, identity: ChatIdentity | null): Promise<boolean> {
  if (!identity) return false;
  const found = await prisma.chatConversation.findUnique({ where: whereShopper(organizationId, identity), select: { id: true } });
  return found !== null;
}

/**
 * The shopper's own conversation with this store, or none yet. Polls pass
 * `after`; `markSeen` records that they have it open (throttled), which is
 * what keeps the reply push quiet while they're watching.
 */
export async function getShopperChat(
  organizationId: string,
  identity: ChatIdentity | null,
  window: MessageWindow = {},
  options: { markSeen?: boolean; now?: Date } = {},
): Promise<ShopperChat> {
  if (!identity) return { conversation: null, messages: [], hasEarlier: false };

  const conversation = await prisma.chatConversation.findUnique({
    where: whereShopper(organizationId, identity),
    select: { id: true, status: true, lastSeq: true, customerReadSeq: true, blockedAt: true },
  });
  if (!conversation) return { conversation: null, messages: [], hasEarlier: false };

  const page = messagePage(organizationId, conversation.id, window);
  const { rows, hasEarlier } = page.finish(await prisma.chatMessage.findMany({ ...page.args, select: SHOPPER_MESSAGE_SELECT }));

  if (options.markSeen) {
    const now = options.now ?? new Date();
    await prisma.chatConversation.updateMany({
      where: {
        id: conversation.id,
        organizationId,
        OR: [{ customerSeenAt: null }, { customerSeenAt: { lt: new Date(now.getTime() - CUSTOMER_SEEN_THROTTLE_MS) } }],
      },
      data: { customerSeenAt: now },
    });
  }

  return {
    conversation: {
      id: conversation.id,
      status: conversation.status,
      unread: unreadCount(conversation.lastSeq, conversation.customerReadSeq),
      blocked: conversation.blockedAt !== null,
    },
    messages: rows.map(toShopperMessage),
    hasEarlier,
  };
}

/**
 * A shopper sends a message. Creates the conversation on the first one, and
 * reopens a resolved one. The product, if given, must be this store's — one
 * that isn't (or no longer exists) is dropped rather than refused, since it is
 * only context.
 */
export async function sendCustomerMessage(
  organizationId: string,
  identity: ChatIdentity,
  input: { clientId: unknown; body: unknown; productId?: unknown; guestName?: unknown },
  now = new Date(),
): Promise<SendResult<ShopperChatMessage>> {
  const checked = validateMessage(input.body);
  if (!checked.ok) return { ok: false, code: 'invalid', message: checked.message };
  if (!isValidClientId(input.clientId)) return { ok: false, code: 'invalid', message: 'Your message wasn’t sent. Please try again.' };
  const clientId = input.clientId;

  if (!(await chatAvailability(organizationId)).open) {
    return { ok: false, code: 'unavailable', message: 'This store isn’t taking messages right now.' };
  }

  let productId: string | null = null;
  if (typeof input.productId === 'string' && input.productId) {
    const product = await prisma.inventoryItem.findFirst({
      where: { id: input.productId, organizationId },
      select: { id: true },
    });
    productId = product?.id ?? null;
  }

  const guestName = identity.kind === 'guest' ? normalizeGuestName(input.guestName) : null;
  const where = whereShopper(organizationId, identity);
  const preview = previewOf(checked.value);

  const attempt = () =>
    prisma.$transaction(async (tx) => {
      const conversation = await tx.chatConversation.upsert({
        where,
        create: {
          organizationId,
          ...(identity.kind === 'customer' ? { customerId: identity.customerId } : { guestKeyHash: identity.guestKeyHash }),
          guestName,
          lastSeq: 1,
          lastMessageAt: now,
          lastSender: 'CUSTOMER',
          lastPreview: preview,
          customerReadSeq: 1,
          customerSeenAt: now,
        },
        update: {
          lastSeq: { increment: 1 },
          lastMessageAt: now,
          lastSender: 'CUSTOMER',
          lastPreview: preview,
          status: 'OPEN',
          resolvedAt: null,
          resolvedByUserId: null,
          customerSeenAt: now,
          ...(guestName ? { guestName } : {}),
        },
        select: { id: true, lastSeq: true, blockedAt: true },
      });
      if (conversation.blockedAt) throw new ChatBlockedError();

      await tx.chatConversation.update({
        where: { id: conversation.id },
        data: { customerReadSeq: conversation.lastSeq },
      });
      const message = await tx.chatMessage.create({
        data: {
          conversationId: conversation.id,
          organizationId,
          seq: conversation.lastSeq,
          sender: 'CUSTOMER',
          body: checked.value,
          productId,
          clientId,
          createdAt: now,
        },
        select: SHOPPER_MESSAGE_SELECT,
      });
      return { conversationId: conversation.id, message };
    });

  /* A unique violation is one of two races, and both end with the row that
   * won: the same clientId already saved (a retry — return it), or two first
   * messages creating the conversation at once (the second simply goes again,
   * now as an update). */
  for (let tries = 0; tries < 2; tries++) {
    try {
      const saved = await attempt();
      notifyChatChanged({ kind: 'message', organizationId, conversationId: saved.conversationId, seq: saved.message.seq, sender: 'CUSTOMER' });
      return { ok: true, conversationId: saved.conversationId, message: toShopperMessage(saved.message) };
    } catch (error) {
      if (error instanceof ChatBlockedError) {
        return { ok: false, code: 'blocked', message: 'Your message wasn’t sent. This store isn’t accepting messages from you.' };
      }
      if (!isUniqueViolation(error)) {
        console.error('[chat] Could not save a shopper message:', error);
        return FAILED;
      }
      const conversation = await prisma.chatConversation.findUnique({ where, select: { id: true } });
      const existing = conversation
        ? await prisma.chatMessage.findUnique({
            where: { conversationId_clientId: { conversationId: conversation.id, clientId } },
            select: SHOPPER_MESSAGE_SELECT,
          })
        : null;
      if (conversation && existing) return { ok: true, conversationId: conversation.id, message: toShopperMessage(existing) };
    }
  }
  return FAILED;
}

/** The shopper has seen the store's messages up to `upToSeq`. Never moves backwards. */
export async function markReadByCustomer(
  organizationId: string,
  identity: ChatIdentity,
  upToSeq: number,
  now = new Date(),
): Promise<void> {
  const conversation = await prisma.chatConversation.findUnique({
    where: whereShopper(organizationId, identity),
    select: { id: true, lastSeq: true },
  });
  if (!conversation) return;
  const target = Math.min(Math.floor(upToSeq), conversation.lastSeq);
  const { count } = await prisma.chatConversation.updateMany({
    where: { id: conversation.id, organizationId, customerReadSeq: { lt: target } },
    data: { customerReadSeq: target, customerSeenAt: now },
  });
  if (count) notifyChatChanged({ kind: 'read', organizationId, conversationId: conversation.id, side: 'CUSTOMER' });
}

/**
 * A guest signs in: their conversation becomes their account's, unless the
 * account already has one with this store — then the guest one is left as
 * it is rather than merged, since two numbered histories can't be interleaved
 * honestly. Returns whether it was adopted.
 */
export async function adoptGuestConversation(organizationId: string, guestKeyHash: string, customerId: string): Promise<boolean> {
  const has = await prisma.chatConversation.findUnique({
    where: { organizationId_customerId: { organizationId, customerId } },
    select: { id: true },
  });
  if (has) return false;
  try {
    const { count } = await prisma.chatConversation.updateMany({
      where: { organizationId, guestKeyHash, customerId: null },
      data: { customerId, guestKeyHash: null, guestName: null },
    });
    return count > 0;
  } catch (error) {
    // The account gained a conversation in the meantime — same outcome as above.
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

/* ─── The store's side ──────────────────────────────────────────────────── */

export interface ConversationRow {
  id: string;
  /** the customer's name, the guest's chosen name, or null for an unnamed guest */
  name: string | null;
  isGuest: boolean;
  preview: string;
  lastMessageAt: string;
  lastSender: ChatSender;
  status: ChatConversationStatus;
  /** messages nobody at the store has seen */
  unread: number;
  awaitingReply: boolean;
  blocked: boolean;
}

const ROW_SELECT = {
  id: true,
  guestName: true,
  customerId: true,
  customer: { select: { name: true } },
  lastPreview: true,
  lastMessageAt: true,
  lastSender: true,
  status: true,
  lastSeq: true,
  staffReadSeq: true,
  blockedAt: true,
} satisfies Prisma.ChatConversationSelect;

function toRow(c: Prisma.ChatConversationGetPayload<{ select: typeof ROW_SELECT }>): ConversationRow {
  const blocked = c.blockedAt !== null;
  return {
    id: c.id,
    name: c.customer?.name ?? c.guestName ?? null,
    isGuest: c.customerId === null,
    preview: c.lastPreview,
    lastMessageAt: c.lastMessageAt.toISOString(),
    lastSender: c.lastSender,
    status: c.status,
    unread: unreadCount(c.lastSeq, c.staffReadSeq),
    awaitingReply: !blocked && isAwaitingReply(c),
    blocked,
  };
}

/**
 * The inbox list, newest first. Search covers the customer's name and
 * email, a guest's name, and message text — run in the database, scoped to
 * this store.
 */
export async function listConversations(
  organizationId: string,
  options: { view?: InboxView; q?: string; page?: number; pageSize?: number } = {},
): Promise<{ rows: ConversationRow[]; total: number }> {
  const pageSize = options.pageSize ?? CONVERSATION_PAGE_SIZE;
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const q = options.q?.trim().slice(0, 100);

  const where: Prisma.ChatConversationWhereInput = { organizationId };
  if (options.view === 'awaiting') Object.assign(where, { status: 'OPEN', lastSender: 'CUSTOMER', blockedAt: null });
  if (options.view === 'resolved') where.status = 'RESOLVED';
  if (q) {
    const contains = { contains: q, mode: 'insensitive' } as const;
    where.OR = [
      { customer: { name: contains } },
      { customer: { email: contains } },
      { guestName: contains },
      { messages: { some: { body: contains } } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.chatConversation.findMany({
      where,
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: ROW_SELECT,
    }),
    prisma.chatConversation.count({ where }),
  ]);
  return { rows: rows.map(toRow), total };
}

export interface StaffConversation extends ConversationRow {
  createdAt: string;
  resolvedAt: string | null;
  customer: {
    id: string;
    /** only when the caller may see customers' contact details */
    email: string | null;
    customerSince: string;
    /** only when the caller may see sales */
    orderCount: number | null;
  } | null;
  /** the product the latest product-page message was sent from */
  latestProductId: string | null;
}

/**
 * One conversation for the Messages page. The caller says what the member
 * may see beyond the conversation itself (AGENTS §7: `customer.view` for
 * contact details, `sales.view` for their orders) — nothing more is read.
 */
export async function getConversationForStaff(
  organizationId: string,
  conversationId: string,
  may: { contact: boolean; orders: boolean },
): Promise<StaffConversation | null> {
  const c = await prisma.chatConversation.findFirst({
    where: { id: conversationId, organizationId },
    select: {
      ...ROW_SELECT,
      createdAt: true,
      resolvedAt: true,
      customer: { select: { id: true, name: true, email: true, createdAt: true } },
    },
  });
  if (!c) return null;

  const [orderCount, latestProduct] = await Promise.all([
    c.customer && may.orders ? prisma.order.count({ where: { organizationId, customerId: c.customer.id } }) : null,
    prisma.chatMessage.findFirst({
      where: { organizationId, conversationId, productId: { not: null } },
      orderBy: { seq: 'desc' },
      select: { productId: true },
    }),
  ]);

  return {
    ...toRow(c),
    createdAt: c.createdAt.toISOString(),
    resolvedAt: c.resolvedAt?.toISOString() ?? null,
    customer: c.customer
      ? {
          id: c.customer.id,
          email: may.contact ? c.customer.email : null,
          customerSince: c.customer.createdAt.toISOString(),
          orderCount,
        }
      : null,
    latestProductId: latestProduct?.productId ?? null,
  };
}

/** A page of a conversation for the store; null when it isn't this store's. */
export async function listStaffMessages(
  organizationId: string,
  conversationId: string,
  window: MessageWindow = {},
): Promise<{ messages: StaffChatMessage[]; hasEarlier: boolean | null; lastSeq: number; staffReadSeq: number } | null> {
  const c = await prisma.chatConversation.findFirst({
    where: { id: conversationId, organizationId },
    select: { lastSeq: true, staffReadSeq: true },
  });
  if (!c) return null;
  const page = messagePage(organizationId, conversationId, window);
  const { rows, hasEarlier } = page.finish(await prisma.chatMessage.findMany({ ...page.args, select: STAFF_MESSAGE_SELECT }));
  return { messages: rows.map(toStaffMessage), hasEarlier, lastSeq: c.lastSeq, staffReadSeq: c.staffReadSeq };
}

/**
 * Someone at the store replies. Works on a resolved conversation too (it
 * reopens — any new message does) and on a blocked one: blocking stops the
 * shopper, not the store. Replying counts as reading.
 */
export async function sendStaffMessage(
  organizationId: string,
  input: { conversationId: string; staffUserId: string; clientId: unknown; body: unknown },
  now = new Date(),
): Promise<SendResult<StaffChatMessage>> {
  const checked = validateMessage(input.body);
  if (!checked.ok) return { ok: false, code: 'invalid', message: checked.message };
  if (!isValidClientId(input.clientId)) return { ok: false, code: 'invalid', message: 'Your reply wasn’t sent. Please try again.' };
  const clientId = input.clientId;
  const preview = previewOf(checked.value);

  const exists = await prisma.chatConversation.findFirst({
    where: { id: input.conversationId, organizationId },
    select: { id: true },
  });
  if (!exists) return { ok: false, code: 'not-found', message: 'That conversation no longer exists.' };

  try {
    const message = await prisma.$transaction(async (tx) => {
      const conversation = await tx.chatConversation.update({
        where: { id: exists.id, organizationId },
        data: {
          lastSeq: { increment: 1 },
          lastMessageAt: now,
          lastSender: 'STAFF',
          lastPreview: preview,
          status: 'OPEN',
          resolvedAt: null,
          resolvedByUserId: null,
          staffAlertedAt: null,
        },
        select: { lastSeq: true },
      });
      await tx.chatConversation.update({
        where: { id: exists.id },
        data: { staffReadSeq: conversation.lastSeq },
      });
      return tx.chatMessage.create({
        data: {
          conversationId: exists.id,
          organizationId,
          seq: conversation.lastSeq,
          sender: 'STAFF',
          staffUserId: input.staffUserId,
          body: checked.value,
          clientId,
          createdAt: now,
        },
        select: STAFF_MESSAGE_SELECT,
      });
    });
    notifyChatChanged({ kind: 'message', organizationId, conversationId: exists.id, seq: message.seq, sender: 'STAFF' });
    return { ok: true, conversationId: exists.id, message: toStaffMessage(message) };
  } catch (error) {
    if (isUniqueViolation(error)) {
      const existing = await prisma.chatMessage.findUnique({
        where: { conversationId_clientId: { conversationId: exists.id, clientId } },
        select: STAFF_MESSAGE_SELECT,
      });
      if (existing) return { ok: true, conversationId: exists.id, message: toStaffMessage(existing) };
    }
    console.error('[chat] Could not save a staff reply:', error);
    return { ok: false, code: 'failed', message: 'Your reply wasn’t sent. Please try again.' };
  }
}

/**
 * The store has seen this conversation up to `upToSeq` — what the member's
 * screen actually showed, not whatever arrived since. Never moves backwards.
 * Clears the unanswered-message email mark, so the next stretch can alert.
 */
export async function markReadByStaff(organizationId: string, conversationId: string, upToSeq: number): Promise<void> {
  const c = await prisma.chatConversation.findFirst({
    where: { id: conversationId, organizationId },
    select: { lastSeq: true },
  });
  if (!c) return;
  const target = Math.min(Math.floor(upToSeq), c.lastSeq);
  const { count } = await prisma.chatConversation.updateMany({
    where: { id: conversationId, organizationId, staffReadSeq: { lt: target } },
    data: { staffReadSeq: target, staffAlertedAt: null },
  });
  if (count) notifyChatChanged({ kind: 'read', organizationId, conversationId, side: 'STAFF' });
}

/** Resolve or reopen. Returns false when the conversation isn't this store's. */
export async function setConversationResolved(
  organizationId: string,
  conversationId: string,
  userId: string,
  resolved: boolean,
  now = new Date(),
): Promise<boolean> {
  const { count } = await prisma.chatConversation.updateMany({
    where: { id: conversationId, organizationId },
    data: resolved
      ? { status: 'RESOLVED', resolvedAt: now, resolvedByUserId: userId }
      : { status: 'OPEN', resolvedAt: null, resolvedByUserId: null },
  });
  if (count) notifyChatChanged({ kind: 'status', organizationId, conversationId });
  return count > 0;
}

/** Block or unblock the shopper. The history stays either way. */
export async function setConversationBlocked(
  organizationId: string,
  conversationId: string,
  userId: string,
  blocked: boolean,
  now = new Date(),
): Promise<boolean> {
  const { count } = await prisma.chatConversation.updateMany({
    where: { id: conversationId, organizationId },
    data: blocked ? { blockedAt: now, blockedByUserId: userId } : { blockedAt: null, blockedByUserId: null },
  });
  if (count) notifyChatChanged({ kind: 'status', organizationId, conversationId });
  return count > 0;
}

/**
 * What the sidebar badge and the inbox's poll need, in one round trip:
 * conversations with something unread (blocked ones never count), and when
 * anything last changed — a member's screen refetches only when that moves.
 */
export interface InboxSummary {
  unreadConversations: number;
  changedAt: string | null;
  /**
   * the most recent conversation with something unread — for "New message
   * from Ada" when one arrives on another page
   */
  latestUnread: { id: string; name: string | null; lastMessageAt: string } | null;
}

export async function inboxSummary(organizationId: string): Promise<InboxSummary> {
  const unreadWhere = { organizationId, blockedAt: null, lastSeq: { gt: prisma.chatConversation.fields.staffReadSeq } };
  const [unreadConversations, latest, newest] = await Promise.all([
    prisma.chatConversation.count({ where: unreadWhere }),
    prisma.chatConversation.aggregate({ where: { organizationId }, _max: { updatedAt: true } }),
    prisma.chatConversation.findFirst({
      where: unreadWhere,
      orderBy: { lastMessageAt: 'desc' },
      select: { id: true, guestName: true, lastMessageAt: true, customer: { select: { name: true } } },
    }),
  ]);
  return {
    unreadConversations,
    changedAt: latest._max.updatedAt?.toISOString() ?? null,
    latestUnread: newest
      ? { id: newest.id, name: newest.customer?.name ?? newest.guestName ?? null, lastMessageAt: newest.lastMessageAt.toISOString() }
      : null,
  };
}

/** What the store sees above a message sent from a product page. */
export interface ChatProductCard {
  id: string;
  name: string;
  /** major units, in the store's currency */
  price: number;
  imageUrl: string | null;
}

/**
 * The products some messages were sent from, this store's only. A product
 * deleted since is simply absent (the message's productId was set to null
 * when it went, by the foreign key).
 */
export async function chatProductCards(organizationId: string, ids: readonly (string | null)[]): Promise<Record<string, ChatProductCard>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (wanted.length === 0) return {};
  const items = await prisma.inventoryItem.findMany({
    where: { organizationId, id: { in: wanted } },
    select: {
      id: true,
      name: true,
      sellingPrice: true,
      images: { orderBy: { sortOrder: 'asc' }, take: 1, select: { url: true } },
    },
  });
  return Object.fromEntries(
    items.map((item) => [
      item.id,
      { id: item.id, name: item.name, price: Number(item.sellingPrice), imageUrl: item.images[0]?.url ?? null },
    ]),
  );
}

/** Someone at the store has Messages open. Written at most once a minute. */
export async function touchInboxSeen(organizationId: string, now = new Date()): Promise<void> {
  await prisma.organization.updateMany({
    where: {
      id: organizationId,
      OR: [{ chatInboxSeenAt: null }, { chatInboxSeenAt: { lt: new Date(now.getTime() - INBOX_SEEN_THROTTLE_MS) } }],
    },
    data: { chatInboxSeenAt: now },
  });
}
