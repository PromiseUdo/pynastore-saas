import { describe, expect, it } from 'vitest';
import {
  CHAT_MESSAGE_MAX,
  CHAT_STORE_AUTHOR,
  GUEST_NAME_MAX,
  POLL_FAST_MS,
  POLL_IDLE_AFTER_MS,
  POLL_MAX_BACKOFF_MS,
  POLL_SLOW_MS,
  PREVIEW_LENGTH,
  conversationHint,
  earliestSeq,
  isAwaitingReply,
  isValidClientId,
  latestSeq,
  mergeMessages,
  nextPollDelay,
  normalizeGuestName,
  parseInboxView,
  previewOf,
  unreadCount,
  validateGreeting,
  validateMessage,
  type ClientMessage,
} from './rules';

describe('validateMessage', () => {
  it('trims and keeps the words', () => {
    expect(validateMessage('  Is this in size 43?  ')).toEqual({ ok: true, value: 'Is this in size 43?' });
  });

  it('refuses nothing, whitespace and non-strings', () => {
    for (const body of ['', '   \n\t ', undefined, null, 42]) {
      expect(validateMessage(body).ok).toBe(false);
    }
  });

  it('allows exactly the ceiling and refuses one past it, counted after trimming', () => {
    expect(validateMessage(`  ${'a'.repeat(CHAT_MESSAGE_MAX)}  `).ok).toBe(true);
    expect(validateMessage('a'.repeat(CHAT_MESSAGE_MAX + 1)).ok).toBe(false);
  });

  it('keeps markup as plain text — it is rendered as text, never HTML', () => {
    expect(validateMessage('<script>alert(1)</script>')).toEqual({ ok: true, value: '<script>alert(1)</script>' });
  });
});

describe('guest name and greeting', () => {
  it('treats a blank guest name as no name, and caps a long one', () => {
    expect(normalizeGuestName('   ')).toBeNull();
    expect(normalizeGuestName(undefined)).toBeNull();
    expect(normalizeGuestName('  Ada   Okafor ')).toBe('Ada Okafor');
    expect(normalizeGuestName('x'.repeat(100))).toHaveLength(GUEST_NAME_MAX);
  });

  it('treats a blank greeting as the interface’s own line', () => {
    expect(validateGreeting('')).toEqual({ ok: true, value: null });
    expect(validateGreeting(' Hello from Ada’s! ')).toEqual({ ok: true, value: 'Hello from Ada’s!' });
    expect(validateGreeting('x'.repeat(201)).ok).toBe(false);
  });
});

describe('isValidClientId', () => {
  it('takes a UUID and short opaque tokens', () => {
    expect(isValidClientId('6f1c1b0e-7d3a-4c8e-9a51-2f0d3c9b8e71')).toBe(true);
    expect(isValidClientId('abcDEF12_-')).toBe(true);
  });

  it('refuses anything else', () => {
    for (const id of ['', 'short', 'has space here', 'x'.repeat(65), '<b>bold</b>', 12345678, null]) {
      expect(isValidClientId(id)).toBe(false);
    }
  });
});

describe('previewOf', () => {
  it('puts a message on one line', () => {
    expect(previewOf('Hello\n\nis this   available?')).toBe('Hello is this available?');
  });

  it('cuts a long message with an ellipsis, inside the length', () => {
    const preview = previewOf('word '.repeat(100));
    expect(preview.length).toBeLessThanOrEqual(PREVIEW_LENGTH);
    expect(preview.endsWith('…')).toBe(true);
  });
});

describe('conversation state', () => {
  it('counts unread from the two marks, never below zero', () => {
    expect(unreadCount(5, 3)).toBe(2);
    expect(unreadCount(3, 5)).toBe(0);
  });

  it('owes a reply only on an open conversation the shopper wrote last', () => {
    expect(isAwaitingReply({ status: 'OPEN', lastSender: 'CUSTOMER' })).toBe(true);
    expect(isAwaitingReply({ status: 'OPEN', lastSender: 'STAFF' })).toBe(false);
    expect(isAwaitingReply({ status: 'RESOLVED', lastSender: 'CUSTOMER' })).toBe(false);
  });

  it('gives the merchant a hint for every state', () => {
    expect(conversationHint({ status: 'OPEN', lastSender: 'CUSTOMER', blocked: false })).toBe('Awaiting your reply');
    expect(conversationHint({ status: 'OPEN', lastSender: 'STAFF', blocked: false })).toBe('Waiting for the customer');
    expect(conversationHint({ status: 'RESOLVED', lastSender: 'STAFF', blocked: false })).toMatch(/^Resolved/);
    expect(conversationHint({ status: 'OPEN', lastSender: 'CUSTOMER', blocked: true })).toMatch(/^Blocked/);
  });

  it('reads the inbox view from the URL, falling back to all', () => {
    expect(parseInboxView('awaiting')).toBe('awaiting');
    expect(parseInboxView('resolved')).toBe('resolved');
    expect(parseInboxView('ACTIVE')).toBe('all');
    expect(parseInboxView(undefined)).toBe('all');
  });

  it('names the store, never a person', () => {
    expect(CHAT_STORE_AUTHOR).toBe('Store team');
  });
});

type M = ClientMessage & { body: string };
const saved = (seq: number, body = `#${seq}`, clientId = `client-${seq}`): M => ({ seq, clientId, body });
const pending = (clientId: string, body: string, state: 'sending' | 'failed' = 'sending'): M => ({
  seq: null,
  clientId,
  body,
  state,
});

describe('mergeMessages', () => {
  it('orders saved messages by seq however they arrive', () => {
    const merged = mergeMessages([saved(3)], [saved(5), saved(1), saved(4)]);
    expect(merged.map((m) => m.seq)).toEqual([1, 3, 4, 5]);
  });

  it('keeps each seq once when polls overlap or repeat', () => {
    const once = mergeMessages([], [saved(1), saved(2)]);
    const twice = mergeMessages(once, [saved(2), saved(3)]);
    const again = mergeMessages(twice, [saved(1), saved(2), saved(3)]);
    expect(again.map((m) => m.seq)).toEqual([1, 2, 3]);
  });

  it('lets the server’s copy win for a seq it already had', () => {
    const merged = mergeMessages([saved(1, 'old')], [saved(1, 'server')]);
    expect(merged).toEqual([saved(1, 'server')]);
  });

  it('replaces a sending message when its clientId comes back saved', () => {
    const typed = mergeMessages([saved(1)], [pending('mine', 'Hello?')]);
    expect(typed).toHaveLength(1); // incoming pending ones are ignored; the caller adds its own
    const local = [saved(1), pending('mine', 'Hello?')];
    const confirmed = mergeMessages(local, [saved(2, 'Hello?', 'mine')]);
    expect(confirmed).toEqual([saved(1), saved(2, 'Hello?', 'mine')]);
  });

  it('keeps unsent and failed messages at the bottom in typing order', () => {
    const local = [saved(1), pending('a', 'first', 'failed'), pending('b', 'second')];
    const merged = mergeMessages(local, [saved(2, 'store reply', 'staff-1')]);
    expect(merged.map((m) => m.body)).toEqual(['#1', 'store reply', 'first', 'second']);
    expect(merged[2].state).toBe('failed');
  });

  it('finds the newest and oldest saved seq, ignoring pending ones', () => {
    const list = [saved(4), saved(9), pending('p', 'x')];
    expect(latestSeq(list)).toBe(9);
    expect(earliestSeq(list)).toBe(4);
    expect(latestSeq([])).toBe(0);
    expect(earliestSeq([pending('p', 'x')])).toBeNull();
  });
});

describe('nextPollDelay', () => {
  it('asks quickly while there is activity, slowly after a quiet minute', () => {
    expect(nextPollDelay({ sinceActivityMs: 0, failures: 0 })).toBe(POLL_FAST_MS);
    expect(nextPollDelay({ sinceActivityMs: POLL_IDLE_AFTER_MS - 1, failures: 0 })).toBe(POLL_FAST_MS);
    expect(nextPollDelay({ sinceActivityMs: POLL_IDLE_AFTER_MS, failures: 0 })).toBe(POLL_SLOW_MS);
  });

  it('backs off after failures, doubling up to a cap', () => {
    const delays = [1, 2, 3, 4, 5, 10].map((failures) => nextPollDelay({ sinceActivityMs: 0, failures }));
    expect(delays).toEqual([6_000, 12_000, 24_000, POLL_MAX_BACKOFF_MS, POLL_MAX_BACKOFF_MS, POLL_MAX_BACKOFF_MS]);
  });

  it('takes the caller’s own intervals for a lighter check', () => {
    expect(nextPollDelay({ sinceActivityMs: 0, failures: 0, fastMs: 60_000, slowMs: 60_000 })).toBe(60_000);
  });

  it('never polls a light check faster because it failed', () => {
    expect(nextPollDelay({ sinceActivityMs: 0, failures: 3, fastMs: 60_000, slowMs: 60_000 })).toBe(60_000);
  });
});
