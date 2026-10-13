/*
 * lib/chat/alerts.ts
 *
 * Getting a message noticed when nobody is looking at it (ROADMAP 17.4).
 * Server only. Both run after the message is saved (Next's `after()`), so
 * neither slows a send, and neither ever throws.
 *
 *   staff email   a shopper wrote and nobody at the store has had Messages
 *                 open in the last couple of minutes → one email to the
 *                 members who can reply. One per unanswered stretch:
 *                 `staffAlertedAt` is claimed here and cleared when someone
 *                 reads the conversation (markReadByStaff) or replies.
 *
 *   shopper push  the store replied, the shopper isn't looking at the chat,
 *                 and their phone or browser asked to be told → "The store
 *                 replied to your message." Every reply is sent, and each
 *                 replaces the last on the phone (the thread `chat:{id}`,
 *                 ROADMAP 18.4) — so a burst of three is one notification
 *                 saying "3 new messages", and the third is never silent.
 *                 "Looking" ends the moment the chat closes or the app goes
 *                 to the background (the panel says so, markShopperAway);
 *                 SHOPPER_WATCHING_MS only covers an app killed before it
 *                 could. The words of the message are never in the
 *                 notification — a lock screen is not a private place.
 *
 * Both decide WHETHER to tell anyone; who hears and how is the notification
 * seam's ('chat.message' and 'chat.reply' in lib/notifications/events.ts).
 */
import { prisma } from '@/lib/prisma';
import { getAdminUrl } from '@/lib/tenant/urls';
import { notify } from '@/lib/notifications/notify';
import type { Tally } from '@/lib/notifications/outbox';

/** Someone who had Messages open this recently is taken to be watching it. */
export const INBOX_WATCHING_MS = 2 * 60_000;
/**
 * A shopper who polled the chat this recently is taken to have it open. The
 * open panel's "seen" mark is written at most every 20s (getShopperChat's
 * throttle), and with real-time live the panel polls every 15s as a backup
 * (SHOPPER_BACKUP_POLL_MS) — so while it's open the mark is never more than
 * about 35s old. 45s keeps a shopper who is looking from being buzzed.
 * Closing the chat clears the mark at once (markShopperAway); this window
 * only matters when the app was killed before it could say so.
 */
export const SHOPPER_WATCHING_MS = 45_000;

/** How much of the shopper's message the email quotes. */
const EMAIL_QUOTE_LENGTH = 300;

export type StaffAlertOutcome = 'sent' | 'inbox-open' | 'already-alerted' | 'no-recipients' | 'not-found' | 'failed';

/**
 * A shopper just wrote. Email the store if nobody is watching and nobody has
 * been told about this conversation since it was last read.
 */
export async function alertStaffAboutMessage(
  organizationId: string,
  conversationId: string,
  now = new Date(),
): Promise<StaffAlertOutcome> {
  try {
    const org = await prisma.organization.findFirst({
      where: { id: organizationId, status: 'ACTIVE' },
      select: { name: true, slug: true, chatInboxSeenAt: true },
    });
    if (!org) return 'not-found';
    if (org.chatInboxSeenAt && now.getTime() - org.chatInboxSeenAt.getTime() < INBOX_WATCHING_MS) return 'inbox-open';

    /* Claimed in one statement, so two messages arriving together send one
     * email. A blocked shopper, or a conversation the store answered last,
     * doesn't alert. */
    const claimed = await prisma.chatConversation.updateMany({
      where: { id: conversationId, organizationId, staffAlertedAt: null, blockedAt: null, lastSender: 'CUSTOMER' },
      data: { staffAlertedAt: now },
    });
    if (claimed.count === 0) return 'already-alerted';

    const conversation = await prisma.chatConversation.findFirst({
      where: { id: conversationId, organizationId },
      select: {
        guestName: true,
        customer: { select: { name: true } },
        messages: { where: { sender: 'CUSTOMER' }, orderBy: { seq: 'desc' }, take: 1, select: { body: true } },
      },
    });
    if (!conversation) return 'not-found';

    // Who: active members who can reply, and the Owner.
    const shopperName = conversation.customer?.name ?? conversation.guestName ?? null;
    const body = conversation.messages[0]?.body ?? '';
    const result = await notify({
      kind: 'chat.message',
      organizationId,
      key: `chat:${conversationId}:staff:${now.getTime()}`,
      facts: { conversationId, shopperName },
      email: {
        template: 'chat-message-alert',
        props: {
          storeName: org.name,
          shopperName,
          isGuest: !conversation.customer,
          message: body.length > EMAIL_QUOTE_LENGTH ? `${body.slice(0, EMAIL_QUOTE_LENGTH).trimEnd()}…` : body,
          conversationUrl: getAdminUrl(org.slug, `/messages?c=${encodeURIComponent(conversationId)}`),
        },
      },
    });
    return result.listed === 0 ? 'no-recipients' : 'sent';
  } catch (error) {
    console.error(`[chat] Could not email the store about conversation ${conversationId}:`, error);
    return 'failed';
  }
}

export type ShopperPushOutcome = 'sent' | 'no-devices' | 'watching' | 'not-found' | 'failed';

/**
 * The store just replied (message `seq`). Tell the shopper's phones and
 * browsers that asked, unless they're looking at the chat right now.
 */
export async function pushStoreReply(
  organizationId: string,
  conversationId: string,
  seq: number,
  now = new Date(),
): Promise<{ outcome: ShopperPushOutcome; tally?: Tally }> {
  try {
    const conversation = await prisma.chatConversation.findFirst({
      where: { id: conversationId, organizationId, organization: { status: 'ACTIVE' } },
      select: {
        customerId: true,
        guestKeyHash: true,
        customerSeenAt: true,
        customerReadSeq: true,
        organization: { select: { name: true } },
        _count: { select: { pushWatches: true } },
      },
    });
    if (!conversation) return { outcome: 'not-found' };
    if (!(await canReachShopper(organizationId, conversation))) return { outcome: 'no-devices' };
    if (conversation.customerSeenAt && now.getTime() - conversation.customerSeenAt.getTime() < SHOPPER_WATCHING_MS) {
      return { outcome: 'watching' };
    }
    // How many of the store's messages they haven't read: the notification says so, and replaces the last one.
    const unread = await prisma.chatMessage.count({
      where: { conversationId, sender: 'STAFF', seq: { gt: conversation.customerReadSeq } },
    });

    // Opens the store's chat page: /chat, or /s/{slug}/chat in the app.
    const { tally } = await notify({
      kind: 'chat.reply',
      organizationId,
      key: `chat:${conversationId}:reply:${seq}`,
      facts: { conversationId, storeName: conversation.organization.name, unread: Math.max(1, unread) },
    });
    return { outcome: 'sent', tally };
  } catch (error) {
    console.error(`[chat] Could not push the store's reply in conversation ${conversationId}:`, error);
    return { outcome: 'failed' };
  }
}

/**
 * Whether the shopper asked to hear about replies anywhere: a phone watching
 * this chat, or (signed in) a phone or browser of their own, or (a guest) a
 * browser with their chat cookie.
 */
async function canReachShopper(
  organizationId: string,
  conversation: { customerId: string | null; guestKeyHash: string | null; _count: { pushWatches: number } },
): Promise<boolean> {
  if (conversation._count.pushWatches > 0) return true;
  if (conversation.customerId) {
    const owned = { organizationId, customerId: conversation.customerId };
    const [devices, browsers] = await Promise.all([
      prisma.pushDevice.count({ where: owned }),
      prisma.webPushSubscription.count({ where: owned }),
    ]);
    return devices + browsers > 0;
  }
  if (conversation.guestKeyHash) {
    return (await prisma.webPushSubscription.count({ where: { organizationId, guestKeyHash: conversation.guestKeyHash } })) > 0;
  }
  return false;
}
