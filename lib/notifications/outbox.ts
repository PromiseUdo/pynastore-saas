/*
 * lib/notifications/outbox.ts
 *
 * Sending what notify() queued, and trying again what failed (ROADMAP 18.1).
 * Server only.
 *
 * Each delivery is claimed before it's sent — one conditional update that
 * also counts the attempt and leases it for LEASE_MS — so the send straight
 * after notify() and the "notification-retries" job can never both send the
 * same one. A temporary failure waits (BACKOFF_MINUTES) and is retried by the
 * job, up to MAX_ATTEMPTS; a permanent one, or the last try, is FAILED.
 * Once a delivery is finished its payload is cleared: the outbox doesn't keep
 * a copy of what was said.
 */
import { prisma } from '@/lib/prisma';
import { Prisma } from '@/lib/generated/prisma/client';
import type { NotificationChannel } from '@/lib/generated/prisma/enums';
import { sendEmailMessage, type EmailMessage } from './channels/email';
import { sendNativePush, type NativePushPayload } from './channels/native-push';
import { sendWebPush, type WebPushPayload } from './channels/web-push';
import type { ChannelOutcome } from './channels/outcome';

export const MAX_ATTEMPTS = 5;
/** How long to wait after the 1st, 2nd, 3rd and 4th failed try. */
export const BACKOFF_MINUTES = [1, 5, 30, 120];
/** A claimed delivery whose sender never finished (a crash mid-send) is free again after this. */
const LEASE_MS = 10 * 60_000;

export interface EmailDeliveryPayload {
  email: EmailMessage;
  to: string[];
}

export type DeliveryPayload = EmailDeliveryPayload | NativePushPayload | WebPushPayload;

type Counts = { sent: number; gone: number; failed: number; retrying: number };
export type Tally = Record<NotificationChannel, Counts>;

export const emptyTally = (): Tally => ({
  EMAIL: { sent: 0, gone: 0, failed: 0, retrying: 0 },
  WEB_PUSH: { sent: 0, gone: 0, failed: 0, retrying: 0 },
  NATIVE_PUSH: { sent: 0, gone: 0, failed: 0, retrying: 0 },
});

interface Delivery {
  id: string;
  channel: NotificationChannel;
  recipient: string;
  payload: Prisma.JsonValue;
  attempts: number;
}

function send(delivery: Delivery): Promise<ChannelOutcome> {
  switch (delivery.channel) {
    case 'EMAIL': {
      const { email, to } = delivery.payload as unknown as EmailDeliveryPayload;
      return sendEmailMessage(email, to).then((ok) => (ok ? 'sent' : 'retry'));
    }
    case 'NATIVE_PUSH':
      return sendNativePush(delivery.recipient, delivery.payload as unknown as NativePushPayload);
    case 'WEB_PUSH':
      return sendWebPush(delivery.recipient, delivery.payload as unknown as WebPushPayload);
  }
}

/** One try at one delivery; null when someone else holds it or it isn't due. */
async function attempt(delivery: Delivery, now = new Date()): Promise<ChannelOutcome | null> {
  const claimed = await prisma.notificationDelivery.updateMany({
    where: { id: delivery.id, status: 'PENDING', nextAttemptAt: { lte: now } },
    data: { attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + LEASE_MS) },
  });
  if (claimed.count === 0) return null;

  let outcome: ChannelOutcome;
  try {
    outcome = await send(delivery);
  } catch (error) {
    console.error(`[notifications] Delivery ${delivery.id} (${delivery.channel}) threw:`, error);
    outcome = 'retry';
  }

  const tries = delivery.attempts + 1;
  const done = { payload: Prisma.DbNull, nextAttemptAt: now };
  if (outcome === 'sent') {
    await prisma.notificationDelivery.update({ where: { id: delivery.id }, data: { ...done, status: 'SENT', sentAt: new Date(), lastError: null } });
  } else if (outcome === 'gone') {
    await prisma.notificationDelivery.update({ where: { id: delivery.id }, data: { ...done, status: 'GONE', lastError: 'no longer exists' } });
  } else if (outcome === 'failed' || tries >= MAX_ATTEMPTS) {
    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: { ...done, status: 'FAILED', lastError: outcome === 'failed' ? 'refused' : `gave up after ${tries} tries` },
    });
    if (outcome === 'retry') outcome = 'failed';
  } else {
    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: { nextAttemptAt: new Date(now.getTime() + BACKOFF_MINUTES[tries - 1] * 60_000), lastError: 'temporary failure' },
    });
  }
  return outcome;
}

const SELECT = { id: true, channel: true, recipient: true, payload: true, attempts: true } as const;

function count(tally: Tally, channel: NotificationChannel, outcome: ChannelOutcome | null) {
  if (!outcome) return;
  const row = tally[channel];
  if (outcome === 'retry') row.retrying += 1;
  else row[outcome] += 1;
}

/** Send everything one event queued (straight after notify()). */
export async function deliverEvent(eventId: string): Promise<Tally> {
  const tally = emptyTally();
  const deliveries = await prisma.notificationDelivery.findMany({ where: { eventId, status: 'PENDING' }, select: SELECT });
  await Promise.all(deliveries.map(async (d) => count(tally, d.channel, await attempt(d))));
  return tally;
}

/** The "notification-retries" job: every delivery that's due, oldest first. */
export async function retryDueDeliveries(options: { limit?: number; now?: Date } = {}) {
  const now = options.now ?? new Date();
  const due = await prisma.notificationDelivery.findMany({
    where: { status: 'PENDING', nextAttemptAt: { lte: now } },
    orderBy: { nextAttemptAt: 'asc' },
    take: options.limit ?? 200,
    select: SELECT,
  });
  const result = { due: due.length, sent: 0, gone: 0, failed: 0, retrying: 0 };
  for (const delivery of due) {
    const outcome = await attempt(delivery, now);
    if (outcome) result[outcome === 'retry' ? 'retrying' : outcome] += 1;
  }
  return result;
}
