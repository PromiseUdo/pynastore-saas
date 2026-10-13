/*
 * lib/notifications/recipients.ts
 *
 * Who an event is for, and every way of reaching them (ROADMAP 18.1).
 * Server only.
 *
 * A PERSON is someone with a notification list and preferences: a staff
 * member (in this shop), a platform staff member, or a shopper with an
 * account here. Each comes with their own phones and browsers.
 *
 * Some ways of reaching someone belong to no person, and follow the event's
 * defaults since there are no preferences to read: the address on a guest's
 * order, PLATFORM_ADMIN_EMAIL, a phone or browser that asked about this one
 * order, a phone watching a chat (they asked, so they hear), and a guest's
 * browsers in a chat.
 */
import { prisma } from '@/lib/prisma';
import { SYSTEM_ROLES } from '@/lib/permissions';
import { WATCH_DAYS } from '@/lib/mobile/push/watch';
import { BUSINESS_APP_ID } from '@/lib/mobile/app-config';
import type { Audience } from './events';
import type { Surface } from './links';

export interface Browser {
  id: string;
  origin: string;
}

export interface Person {
  userId: string | null;
  customerId: string | null;
  /** the shop's id, or "platform" — what their preferences are kept under */
  scope: string;
  /** the shop the notification row belongs to; null for platform staff */
  organizationId: string | null;
  /** where they read: an email address, or null when we don't email them */
  email: string | null;
  /** which pages their links open */
  surface: Surface;
  devices: string[];
  browsers: Browser[];
}

export interface Reach {
  people: Person[];
  /** not a person with preferences: a guest order's address, PLATFORM_ADMIN_EMAIL */
  emails: string[];
  /** phones that asked about this order or chat */
  watchingDevices: string[];
  /** a guest's browsers: in a chat, or watching this order */
  guestBrowsers: Browser[];
}

export const PLATFORM_SCOPE = 'platform';

/** PLATFORM_ADMIN_EMAIL: one address, or several separated by commas. */
export function platformAdminEmails(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAIL ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function resolveRecipients(organizationId: string | null, audiences: Audience[]): Promise<Reach> {
  const people = new Map<string, Person>();
  const emails = new Set<string>();
  const watchingDevices = new Set<string>();
  const guestBrowsers: Browser[] = [];

  const add = (person: Omit<Person, 'devices' | 'browsers'>) => {
    const key = `${person.userId ?? ''}|${person.customerId ?? ''}|${person.scope}`;
    if (!people.has(key)) people.set(key, { ...person, devices: [], browsers: [] });
  };

  for (const audience of audiences) {
    switch (audience.type) {
      case 'staff': {
        if (!organizationId) break;
        const members = await prisma.membership.findMany({
          where: {
            organizationId,
            status: 'ACTIVE',
            // Store access (8.6): no rows means every store.
            ...(audience.warehouseId ? { OR: [{ warehouses: { none: {} } }, { warehouses: { some: { warehouseId: audience.warehouseId } } }] } : {}),
            role: {
              OR: [
                { rolePermissions: { some: { permission: { key: audience.permission } } } },
                ...(audience.owner ? [{ isSystem: true, name: SYSTEM_ROLES.OWNER.name }] : []),
              ],
            },
          },
          select: { userId: true, user: { select: { email: true } } },
        });
        for (const m of members) {
          add({ userId: m.userId, customerId: null, scope: organizationId, organizationId, email: m.user.email || null, surface: 'admin' });
        }
        break;
      }

      case 'order-shopper': {
        if (!organizationId) break;
        const since = new Date(Date.now() - WATCH_DAYS * 86_400_000);
        const order = await prisma.order.findFirst({
          where: { id: audience.orderId, organizationId },
          select: {
            email: true,
            customer: { select: { id: true, accountDeletedAt: true, passwordHash: true, _count: { select: { oauthAccounts: true } } } },
            pushWatches: { where: { createdAt: { gte: since } }, select: { deviceId: true } },
            webPushWatches: { where: { createdAt: { gte: since } }, select: { subscription: { select: { id: true, origin: true } } } },
          },
        });
        if (!order) break;
        const customer = order.customer;
        const hasAccount = customer && !customer.accountDeletedAt && (customer.passwordHash || customer._count.oauthAccounts > 0);
        if (hasAccount) {
          add({ userId: null, customerId: customer.id, scope: organizationId, organizationId, email: order.email, surface: 'store' });
        } else if (order.email) {
          emails.add(order.email);
        }
        for (const watch of order.pushWatches) watchingDevices.add(watch.deviceId);
        for (const watch of order.webPushWatches) guestBrowsers.push(watch.subscription);
        break;
      }

      case 'chat-shopper': {
        if (!organizationId) break;
        const conversation = await prisma.chatConversation.findFirst({
          where: { id: audience.conversationId, organizationId },
          select: { customerId: true, guestKeyHash: true, pushWatches: { select: { deviceId: true } } },
        });
        if (!conversation) break;
        if (conversation.customerId) {
          // No email: chat replies were never emailed (17.4).
          add({ userId: null, customerId: conversation.customerId, scope: organizationId, organizationId, email: null, surface: 'store' });
        } else if (conversation.guestKeyHash) {
          guestBrowsers.push(
            ...(await prisma.webPushSubscription.findMany({
              where: { organizationId, guestKeyHash: conversation.guestKeyHash, audience: 'SHOPPER' },
              select: { id: true, origin: true },
            })),
          );
        }
        for (const watch of conversation.pushWatches) watchingDevices.add(watch.deviceId);
        break;
      }

      case 'platform': {
        const staff = await prisma.user.findMany({ where: { isPlatformStaff: true }, select: { id: true } });
        // Platform email still goes to PLATFORM_ADMIN_EMAIL, as it always has.
        for (const user of staff) {
          add({ userId: user.id, customerId: null, scope: PLATFORM_SCOPE, organizationId: null, email: null, surface: 'platform' });
        }
        for (const address of platformAdminEmails()) emails.add(address);
        break;
      }
    }
  }

  const list = [...people.values()];
  await attachDevicesAndBrowsers(organizationId, list);
  return { people: list, emails: [...emails], watchingDevices: [...watchingDevices], guestBrowsers };
}

/** Each person's own phones (signed-in shoppers in the store's app; staff in the business app) and browsers. */
async function attachDevicesAndBrowsers(organizationId: string | null, people: Person[]): Promise<void> {
  const staffIds = people.filter((p) => p.userId && p.scope !== PLATFORM_SCOPE).map((p) => p.userId!);
  const platformIds = people.filter((p) => p.userId && p.scope === PLATFORM_SCOPE).map((p) => p.userId!);
  const customerIds = people.filter((p) => p.customerId).map((p) => p.customerId!);
  if (staffIds.length + platformIds.length + customerIds.length === 0) return;

  const [browsers, devices] = await Promise.all([
    prisma.webPushSubscription.findMany({
      where: {
        OR: [
          ...(staffIds.length && organizationId ? [{ userId: { in: staffIds }, organizationId, audience: 'STAFF' as const }] : []),
          ...(platformIds.length ? [{ userId: { in: platformIds }, audience: 'PLATFORM' as const }] : []),
          ...(customerIds.length ? [{ customerId: { in: customerIds }, audience: 'SHOPPER' as const }] : []),
        ],
      },
      select: { id: true, origin: true, userId: true, customerId: true, audience: true },
    }),
    prisma.pushDevice.findMany({
      where: {
        OR: [
          ...(customerIds.length && organizationId ? [{ organizationId, customerId: { in: customerIds } }] : []),
          // Staff hear on their phones through the business app, whichever shop it's about (ROADMAP 19.4).
          ...(staffIds.length && organizationId ? [{ userId: { in: staffIds }, appId: BUSINESS_APP_ID }] : []),
        ],
      },
      select: { id: true, customerId: true, userId: true },
    }),
  ]);

  for (const person of people) {
    if (person.customerId) {
      person.browsers = browsers.filter((b) => b.customerId === person.customerId).map(({ id, origin }) => ({ id, origin }));
      person.devices = devices.filter((d) => d.customerId === person.customerId).map((d) => d.id);
    } else if (person.userId) {
      const audience = person.scope === PLATFORM_SCOPE ? 'PLATFORM' : 'STAFF';
      person.browsers = browsers
        .filter((b) => b.userId === person.userId && b.audience === audience)
        .map(({ id, origin }) => ({ id, origin }));
      if (audience === 'STAFF') person.devices = devices.filter((d) => d.userId === person.userId && !d.customerId).map((d) => d.id);
    }
  }
}
