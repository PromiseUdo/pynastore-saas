/*
 * lib/notifications/readers.ts
 *
 * Whose notification list is being read (ROADMAP 18.2). A reader is always
 * built on the server from the session — never from the browser:
 *
 *   staff     a member, in one shop: switching shop switches the list
 *   platform  a platform staff member: the console's list
 *   shopper   a signed-in shopper, in one shop
 */
import { prisma } from '@/lib/prisma';
import { PLATFORM_SCOPE, type Person } from './recipients';

export type Reader =
  | { kind: 'staff'; userId: string; organizationId: string }
  | { kind: 'platform'; userId: string }
  | { kind: 'shopper'; customerId: string; organizationId: string };

/** The rows that are this reader's. Any id from a browser is used only together with this. */
export function whose(reader: Reader) {
  switch (reader.kind) {
    case 'staff':
      return { userId: reader.userId, organizationId: reader.organizationId };
    case 'platform':
      return { userId: reader.userId, organizationId: null };
    case 'shopper':
      return { customerId: reader.customerId, organizationId: reader.organizationId };
  }
}

/** The reader a recipient of notify() reads their list as. */
export function readerOf(person: Pick<Person, 'userId' | 'customerId' | 'scope' | 'organizationId'>): Reader | null {
  if (person.userId && person.scope === PLATFORM_SCOPE) return { kind: 'platform', userId: person.userId };
  if (person.userId && person.organizationId) return { kind: 'staff', userId: person.userId, organizationId: person.organizationId };
  if (person.customerId && person.organizationId) return { kind: 'shopper', customerId: person.customerId, organizationId: person.organizationId };
  return null;
}

export function unreadCount(reader: Reader): Promise<number> {
  return prisma.notification.count({ where: { ...whose(reader), readAt: null } });
}
