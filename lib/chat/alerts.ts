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
 *                 and their phone (in the store's own app) asked to be told
 *                 → "The store replied to your message." Only for the first
 *                 unread reply, so a burst of three is one buzz. The words
 *                 of the message are never in the notification — a lock
 *                 screen is not a private place.
 */
import { prisma } from '@/lib/prisma';
import { PERMISSIONS, SYSTEM_ROLES } from '@/lib/permissions';
import { getAdminUrl } from '@/lib/tenant/urls';
import { sendChatMessageAlertEmail } from '@/lib/email';
import { sendToDevices, type PushTally } from '@/lib/mobile/push/send';

/** Someone who had Messages open this recently is taken to be watching it. */
export const INBOX_WATCHING_MS = 2 * 60_000;
/** A shopper who polled the chat this recently is taken to have it open. */
export const SHOPPER_WATCHING_MS = 30_000;

/** How much of the shopper's message the email quotes. */
const EMAIL_QUOTE_LENGTH = 300;

export type StaffAlertOutcome = 'sent' | 'inbox-open' | 'already-alerted' | 'no-recipients' | 'not-found' | 'failed';

/** The people an unanswered message is for: active members who can reply, and the Owner. */
async function replyingMembers(organizationId: string): Promise<string[]> {
  const members = await prisma.membership.findMany({
    where: {
      organizationId,
      status: 'ACTIVE',
      role: {
        OR: [
          { rolePermissions: { some: { permission: { key: PERMISSIONS.MESSAGES_REPLY } } } },
          { isSystem: true, name: SYSTEM_ROLES.OWNER.name },
        ],
      },
    },
    select: { user: { select: { email: true } } },
  });
  return [...new Set(members.map((m) => m.user.email).filter((e): e is string => Boolean(e)))];
}

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

    const [to, conversation] = await Promise.all([
      replyingMembers(organizationId),
      prisma.chatConversation.findFirst({
        where: { id: conversationId, organizationId },
        select: {
          guestName: true,
          customer: { select: { name: true } },
          messages: { where: { sender: 'CUSTOMER' }, orderBy: { seq: 'desc' }, take: 1, select: { body: true } },
        },
      }),
    ]);
    if (!conversation) return 'not-found';
    if (to.length === 0) return 'no-recipients';

    const body = conversation.messages[0]?.body ?? '';
    await sendChatMessageAlertEmail({
      to,
      storeName: org.name,
      shopperName: conversation.customer?.name ?? conversation.guestName ?? null,
      isGuest: !conversation.customer,
      message: body.length > EMAIL_QUOTE_LENGTH ? `${body.slice(0, EMAIL_QUOTE_LENGTH).trimEnd()}…` : body,
      conversationUrl: getAdminUrl(org.slug, `/messages?c=${encodeURIComponent(conversationId)}`),
    });
    return 'sent';
  } catch (error) {
    console.error(`[chat] Could not email the store about conversation ${conversationId}:`, error);
    return 'failed';
  }
}

export type ShopperPushOutcome = 'sent' | 'no-devices' | 'watching' | 'already-told' | 'not-found' | 'failed';

/** The words of a reply notification. Fixed: never the message itself. */
export function chatReplyPushMessage(storeName: string) {
  return { title: storeName, body: 'The store replied to your message.' };
}

/**
 * The store just replied (message `seq`). Buzz the shopper's phones that
 * asked, unless they're looking at the chat or already have an unread reply
 * they were told about.
 */
export async function pushStoreReply(
  organizationId: string,
  conversationId: string,
  seq: number,
  now = new Date(),
): Promise<{ outcome: ShopperPushOutcome; tally?: PushTally }> {
  try {
    const conversation = await prisma.chatConversation.findFirst({
      where: { id: conversationId, organizationId, organization: { status: 'ACTIVE' } },
      select: {
        customerSeenAt: true,
        customerReadSeq: true,
        organization: { select: { name: true, slug: true } },
        pushWatches: { select: { device: { select: { id: true, appId: true, platform: true, token: true } } } },
      },
    });
    if (!conversation) return { outcome: 'not-found' };
    if (conversation.pushWatches.length === 0) return { outcome: 'no-devices' };
    if (conversation.customerSeenAt && now.getTime() - conversation.customerSeenAt.getTime() < SHOPPER_WATCHING_MS) {
      return { outcome: 'watching' };
    }
    // Only the first reply they haven't seen; later ones in the same stretch stay quiet.
    if (seq - conversation.customerReadSeq !== 1) return { outcome: 'already-told' };

    const tally = await sendToDevices(
      organizationId,
      conversation.pushWatches.map((w) => w.device),
      chatReplyPushMessage(conversation.organization.name),
      // Opens the store's chat page in the app (components/native/native-shell.tsx).
      { path: `/s/${conversation.organization.slug}/chat` },
      `conversation ${conversationId}`,
    );
    return { outcome: 'sent', tally };
  } catch (error) {
    console.error(`[chat] Could not push the store's reply in conversation ${conversationId}:`, error);
    return { outcome: 'failed' };
  }
}
