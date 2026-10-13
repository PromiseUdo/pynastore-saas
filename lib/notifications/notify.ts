/*
 * lib/notifications/notify.ts
 *
 * THE seam (ROADMAP 18): code that has something to tell people calls
 * notify() and nothing else — never an email sender or a push transport
 * directly. Server only.
 *
 *   1. who it's for and how to reach them (./recipients.ts), filtered by
 *      their preferences (./preferences.ts) and the event's defaults;
 *   2. in one transaction: the event (its key makes raising it twice a
 *      no-op), a row in each person's list, and an outbox row per email,
 *      phone and browser;
 *   3. the outbox is sent straight away (./outbox.ts); anything that failed
 *      for a passing reason is retried by the "notification-retries" job;
 *   4. each person's open bell hears their new unread count (./realtime.ts),
 *      after the response.
 *
 * Call it after the change it describes has committed, never inside that
 * transaction. Where the person who caused it shouldn't wait for the sending,
 * call it inside runAfter (lib/run-after.ts). It never throws.
 *
 * Deciding WHETHER to tell anyone (the shopper has the chat open, staff
 * were already alerted) stays with the caller; this decides who and how.
 */
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@/lib/generated/prisma/client';
import type { NotificationChannel } from '@/lib/generated/prisma/enums';
import { eventDefinition, type EventFacts, type NotificationKind } from './events';
import { appPathFor, businessAppPathFor, pathFor } from './links';
import { loadChoices, personKey, wants } from './preferences';
import { resolveRecipients, type Browser, type Person } from './recipients';
import { deliverEvent, emptyTally, type DeliveryPayload, type Tally } from './outbox';
import { announceListChanged } from './realtime';
import { readerOf, type Reader } from './readers';
import { runAfter } from '@/lib/run-after';
import type { EmailMessage } from './channels/email';

export interface NotifyInput<K extends NotificationKind> {
  kind: K;
  /** the shop it happened in; null for platform-wide events */
  organizationId: string | null;
  facts: EventFacts[K];
  /** raising an event with the same key again sends nothing; omit when there's no natural one */
  key?: string;
  /** the email, when the event has one: its template and props, built by the caller */
  email?: EmailMessage;
  /** who did the thing: they aren't told about it (18.0) */
  actorUserId?: string | null;
}

export interface NotifyResult {
  /** an event with this key was raised before, so nothing was sent */
  duplicate: boolean;
  /** how many people got it in their list */
  listed: number;
  tally: Tally;
}

const nothing = (duplicate = false): NotifyResult => ({ duplicate, listed: 0, tally: emptyTally() });

export async function notify<K extends NotificationKind>(input: NotifyInput<K>): Promise<NotifyResult> {
  try {
    if (input.key && (await prisma.notificationEvent.findUnique({ where: { key: input.key }, select: { id: true } }))) {
      return nothing(true);
    }

    const definition = eventDefinition(input.kind);
    const { facts } = input;
    const [org, reach] = await Promise.all([
      input.organizationId
        ? prisma.organization.findUnique({ where: { id: input.organizationId }, select: { slug: true, customStoreDomain: true } })
        : Promise.resolve(null),
      resolveRecipients(input.organizationId, definition.audiences(facts)),
    ]);
    if (input.organizationId && !org) return nothing();
    if (input.actorUserId) reach.people = reach.people.filter((person) => person.userId !== input.actorUserId);

    const choices = await loadChoices(reach.people, definition.category);
    const allowed = (person: Person, channel: NotificationChannel) =>
      wants(definition.channels[channel], choices.get(personKey(person))?.[channel]);
    const byDefault = (channel: NotificationChannel) => wants(definition.channels[channel], undefined);

    const words = definition.words(facts);
    const target = definition.target(facts);
    const threadKey = definition.thread?.(facts) ?? null;
    const pushes = definition.pushes?.(facts) ?? true;

    const deliveries: { channel: NotificationChannel; recipient: string; payload: DeliveryPayload }[] = [];

    // One email, to everyone it's for — as each of these emails always went.
    // A digest kind's email waits for the day's summary (./digest.ts).
    if (input.email && definition.channels.EMAIL !== 'digest') {
      const to = new Set<string>();
      for (const person of reach.people) if (person.email && allowed(person, 'EMAIL')) to.add(person.email);
      if (byDefault('EMAIL')) for (const address of reach.emails) to.add(address);
      if (to.size > 0) {
        deliveries.push({ channel: 'EMAIL', recipient: [...to].join(', '), payload: { email: input.email, to: [...to] } });
      }
    }

    if (pushes) {
      // A shopper's phone is in the store's own app, so it opens the store's
      // page there; a staff member's is in the business app (ROADMAP 19.4),
      // where /o/{slug}/… opens this shop's admin page, whichever shop the
      // app was last on.
      const storeAppPath = org ? appPathFor(target, org.slug) : null;
      const businessPath = org ? businessAppPathFor(target, org.slug) : null;
      const devices = new Map<string, string>();
      const addDevice = (id: string, path: string | null) => {
        if (path && !devices.has(id)) devices.set(id, path);
      };
      for (const person of reach.people) {
        if (!allowed(person, 'NATIVE_PUSH')) continue;
        const path = person.surface === 'admin' ? businessPath : person.surface === 'store' ? storeAppPath : null;
        person.devices.forEach((id) => addDevice(id, path));
      }
      if (byDefault('NATIVE_PUSH')) reach.watchingDevices.forEach((id) => addDevice(id, storeAppPath));
      for (const [id, path] of devices) {
        deliveries.push({
          channel: 'NATIVE_PUSH',
          recipient: id,
          payload: { title: words.title, body: words.body, path, ...(threadKey ? { thread: threadKey } : {}) },
        });
      }

      // A browser opens the page on its own origin, for the surface it belongs to.
      const browsers = new Map<string, string>();
      const addBrowser = (browser: Browser, surface: Person['surface']) => {
        const path = pathFor(target, surface);
        if (path && !browsers.has(browser.id)) browsers.set(browser.id, `${browser.origin}${path}`);
      };
      for (const person of reach.people) if (allowed(person, 'WEB_PUSH')) person.browsers.forEach((b) => addBrowser(b, person.surface));
      if (byDefault('WEB_PUSH')) reach.guestBrowsers.forEach((b) => addBrowser(b, 'store'));
      for (const [id, url] of browsers) {
        deliveries.push({
          channel: 'WEB_PUSH',
          recipient: id,
          payload: { title: words.title, body: words.body, url, ...(threadKey ? { tag: threadKey } : {}) },
        });
      }
    }

    let eventId: string;
    try {
      eventId = await prisma.$transaction(async (tx) => {
        const event = await tx.notificationEvent.create({
          data: { key: input.key ?? `${input.kind}:${randomUUID()}`, kind: input.kind, organizationId: input.organizationId },
          select: { id: true },
        });
        if (reach.people.length > 0) {
          await tx.notification.createMany({
            data: reach.people.map((person) => ({
              eventId: event.id,
              userId: person.userId,
              customerId: person.customerId,
              organizationId: person.organizationId,
              kind: input.kind,
              title: words.title,
              body: words.body,
              target: target as unknown as Prisma.InputJsonValue,
              threadKey,
            })),
          });
        }
        if (deliveries.length > 0) {
          await tx.notificationDelivery.createMany({
            data: deliveries.map((d) => ({ ...d, eventId: event.id, payload: d.payload as unknown as Prisma.InputJsonValue })),
          });
        }
        return event.id;
      });
    } catch (error) {
      // Raised twice at once: the other one is sending it.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return nothing(true);
      throw error;
    }

    const readers = reach.people.map(readerOf).filter((r): r is Reader => r !== null);
    runAfter(() => announceListChanged(readers));

    return { duplicate: false, listed: reach.people.length, tally: await deliverEvent(eventId) };
  } catch (error) {
    console.error(`[notifications] Could not raise ${input.kind}:`, error);
    return nothing();
  }
}
