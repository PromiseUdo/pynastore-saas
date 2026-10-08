/*
 * lib/chat/storefront.ts
 *
 * The storefront's server-side entry points into Messages (ROADMAP 17.3):
 * which store an API request is for, what the layout needs to know on
 * first paint, and handing a guest's conversation to the account they sign
 * in to.
 *
 * The store is never a field the browser chooses: on an API route it comes
 * from resolveRequestStore (hostname, or the mobile mall's page path), on a
 * page from the slug proxy.ts resolved.
 */
import { prisma } from '@/lib/prisma';
import { resolveRequestStore } from '@/lib/storefront/request-store';
import { adoptGuestConversation } from './service';
import { currentChatIdentity, currentGuestKeyHash } from './identity';
import { unreadCount } from './rules';

export interface ChatStore {
  slug: string;
  organizationId: string;
}

export type ChatStoreResult = { ok: true; store: ChatStore } | { ok: false; status: number; error: string };

/** The store a /api/storefront/chat request is for — live shops only. */
export async function chatStoreFromRequest(request: Request, claimedOrg?: string | null): Promise<ChatStoreResult> {
  const resolved = await resolveRequestStore(request, claimedOrg);
  if (!resolved.ok) return { ok: false, status: resolved.status, error: resolved.error };
  const org = await prisma.organization.findFirst({
    where: { slug: resolved.slug, status: 'ACTIVE' },
    select: { id: true },
  });
  if (!org) return { ok: false, status: 404, error: 'Store not found.' };
  return { ok: true, store: { slug: resolved.slug, organizationId: org.id } };
}

/**
 * For the storefront layout: is there a conversation for whoever is
 * looking, and how many of the store's messages haven't they seen? Lets the
 * badge paint on first load, and lets a browser that has never written skip
 * the background check entirely. Never throws — a shop must render without it.
 */
export async function shopperChatStatus(store: ChatStore): Promise<{ exists: boolean; unread: number }> {
  try {
    const identity = await currentChatIdentity(store);
    if (!identity) return { exists: false, unread: 0 };
    const conversation = await prisma.chatConversation.findUnique({
      where:
        identity.kind === 'customer'
          ? { organizationId_customerId: { organizationId: store.organizationId, customerId: identity.customerId } }
          : { organizationId_guestKeyHash: { organizationId: store.organizationId, guestKeyHash: identity.guestKeyHash } },
      select: { lastSeq: true, customerReadSeq: true },
    });
    if (!conversation) return { exists: false, unread: 0 };
    return { exists: true, unread: unreadCount(conversation.lastSeq, conversation.customerReadSeq) };
  } catch {
    return { exists: false, unread: 0 };
  }
}

/**
 * A shopper has just signed in (or registered, or reset their password)
 * on this browser: if they wrote as a guest here first, that conversation
 * becomes their account's. Never stops a sign-in — a failure here only
 * means the guest conversation stays a guest one.
 */
export async function adoptGuestChatOnSignIn(store: { id: string; slug: string }, customerId: string): Promise<void> {
  try {
    const guestKeyHash = await currentGuestKeyHash(store.slug);
    if (guestKeyHash) await adoptGuestConversation(store.id, guestKeyHash, customerId);
  } catch (error) {
    console.error('[chat] Could not adopt a guest conversation on sign-in:', error);
  }
}
