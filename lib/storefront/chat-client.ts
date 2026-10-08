'use client';

/*
 * The storefront chat's calls to /api/storefront/chat (ROADMAP 17.3).
 *
 * `org` is the slug the page was rendered for. The server decides the store
 * from the request itself and only uses this as a cross-check — the mobile
 * mall needs it when a browser sends no Referer.
 */
import type { ChatConversationStatus, ShopperChatMessage } from '@/lib/chat/rules';

export interface ShopperChatResponse {
  conversation: { id: string; status: ChatConversationStatus; unread: number; blocked: boolean } | null;
  messages: ShopperChatMessage[];
  hasEarlier: boolean | null;
  /** the store is taking messages right now */
  open: boolean;
}

export class ChatRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

const SEND_FAILED = 'Your message wasn’t sent. Check your connection and try again.';

async function readError(response: Response, fallback: string): Promise<ChatRequestError> {
  try {
    const body = (await response.json()) as { error?: string; code?: string };
    return new ChatRequestError(body.error || fallback, response.status, body.code);
  } catch {
    return new ChatRequestError(fallback, response.status);
  }
}

export async function fetchShopperChat(
  org: string,
  query: { after?: number; before?: number; open?: boolean; summary?: boolean } = {},
): Promise<ShopperChatResponse> {
  const params = new URLSearchParams({ org });
  if (query.after !== undefined) params.set('after', String(query.after));
  if (query.before !== undefined) params.set('before', String(query.before));
  if (query.open) params.set('open', '1');
  if (query.summary) params.set('summary', '1');
  const response = await fetch(`/api/storefront/chat?${params}`, { cache: 'no-store' });
  if (!response.ok) throw await readError(response, 'We couldn’t load your messages.');
  return (await response.json()) as ShopperChatResponse;
}

export async function sendShopperMessage(
  org: string,
  message: { clientId: string; body: string; productId?: string | null; guestName?: string },
): Promise<ShopperChatMessage> {
  let response: Response;
  try {
    response = await fetch('/api/storefront/chat/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org, ...message }),
    });
  } catch {
    throw new ChatRequestError(SEND_FAILED, 0);
  }
  if (!response.ok) throw await readError(response, SEND_FAILED);
  return ((await response.json()) as { message: ShopperChatMessage }).message;
}

/** Link this phone to the shopper's conversation, so the store's replies are pushed (ROADMAP 17.4). */
export async function notifyChatReplies(org: string, deviceToken: string): Promise<boolean> {
  try {
    const response = await fetch('/api/storefront/chat/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org, deviceToken }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Best effort: a missed read mark only means the badge lingers until the next one. */
export async function markShopperChatRead(org: string, upTo: number): Promise<void> {
  try {
    await fetch('/api/storefront/chat/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org, upTo }),
    });
  } catch {
    // The next poll tries again.
  }
}
