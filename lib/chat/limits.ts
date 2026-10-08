/*
 * lib/chat/limits.ts
 *
 * How fast shoppers may send messages (ROADMAP 17.5). Guests can chat
 * without an account, which makes the chat an anonymous way into a
 * merchant's inbox — so sending is limited, and only sending: reading and
 * polling never take a bucket (that would be a database write every few
 * seconds).
 *
 *   per sender     10 a minute, 60 an hour — the shopper's account, or the
 *                  guest's key (made before their first message is checked)
 *   per IP         30 a minute, 200 an hour — looser, because mobile carriers
 *                  put many shoppers behind one address
 *   new guests     5 new guest conversations a day from one IP, so a script
 *                  can't open endless fresh conversations by dropping its
 *                  cookie
 *   per store      300 guest messages an hour — a ceiling so one flood can't
 *                  bury a merchant; signed-in shoppers don't count toward it
 *
 * Every key is namespaced by store, so one store's traffic never counts
 * against another's. The numbers can be overridden by environment variable
 * without a code change. Built on lib/rate-limit.ts, whose counters every
 * server instance shares; if that store can't be reached, sends go through
 * (a request limit fails open).
 */
import { requestLimitRetryAfter, type LimitCheck } from '@/lib/rate-limit';
import type { ChatIdentity } from './identity';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

export function chatSendLimits() {
  return {
    senderPerMinute: envInt('CHAT_SENDER_MAX_PER_MINUTE', 10),
    senderPerHour: envInt('CHAT_SENDER_MAX_PER_HOUR', 60),
    ipPerMinute: envInt('CHAT_IP_MAX_PER_MINUTE', 30),
    ipPerHour: envInt('CHAT_IP_MAX_PER_HOUR', 200),
    newGuestsPerIpPerDay: envInt('CHAT_NEW_GUESTS_PER_IP_PER_DAY', 5),
    storeGuestPerHour: envInt('CHAT_STORE_GUEST_MAX_PER_HOUR', 300),
  };
}

export const CHAT_TOO_FAST = 'You’re sending messages a little fast. Give it a moment and try again.';

export type ChatSendCheck = { ok: true } | { ok: false; retryAfterSeconds: number };

/**
 * Take one send from every bucket that applies. Call it only when a message
 * is about to be saved — after the message itself has been checked — so a
 * rejected draft doesn't use up the shopper's allowance.
 *
 * @param identity who is sending — for a guest's very first message, the key
 *   they are about to be given (newGuestIdentity)
 * @param startsConversation the sender has no conversation with this store yet
 */
export async function checkChatSend(input: {
  storeSlug: string;
  identity: ChatIdentity;
  ip: string;
  startsConversation: boolean;
}): Promise<ChatSendCheck> {
  const L = chatSendLimits();
  const { storeSlug, identity, ip } = input;
  const isGuest = identity.kind === 'guest';
  const sender = identity.kind === 'customer' ? `c:${identity.customerId}` : `g:${identity.guestKeyHash}`;

  const checks: LimitCheck[] = [
    { key: `chat:sender:min:${storeSlug}:${sender}`, limit: L.senderPerMinute, windowMs: MINUTE },
    { key: `chat:sender:hour:${storeSlug}:${sender}`, limit: L.senderPerHour, windowMs: HOUR },
    { key: `chat:ip:min:${storeSlug}:${ip}`, limit: L.ipPerMinute, windowMs: MINUTE },
    { key: `chat:ip:hour:${storeSlug}:${ip}`, limit: L.ipPerHour, windowMs: HOUR },
    ...(isGuest && input.startsConversation
      ? [{ key: `chat:newguest:day:${storeSlug}:${ip}`, limit: L.newGuestsPerIpPerDay, windowMs: DAY }]
      : []),
    ...(isGuest ? [{ key: `chat:store:guest:hour:${storeSlug}`, limit: L.storeGuestPerHour, windowMs: HOUR }] : []),
  ];

  const retryAfter = await requestLimitRetryAfter(checks);
  return retryAfter === null ? { ok: true } : { ok: false, retryAfterSeconds: retryAfter };
}
