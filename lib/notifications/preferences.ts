/*
 * lib/notifications/preferences.ts
 *
 * Whether a person wants a category on a channel (ROADMAP 18.1; the screens
 * come with 18.6). Only choices that differ from the event's default are
 * stored; a `required` channel can't be turned off, and a channel the event
 * doesn't list is never used.
 */
import { prisma } from '@/lib/prisma';
import type { NotificationChannel } from '@/lib/generated/prisma/enums';
import type { ChannelDefault, NotificationCategory } from './events';
import type { Person } from './recipients';

export type Choices = Map<string, Partial<Record<NotificationChannel, boolean>>>;

export const personKey = (person: Pick<Person, 'userId' | 'customerId' | 'scope'>) =>
  person.userId ? `u:${person.userId}:${person.scope}` : `c:${person.customerId}:${person.scope}`;

/** Everyone's stored choices for one category, in one query. */
export async function loadChoices(people: Person[], category: NotificationCategory): Promise<Choices> {
  const choices: Choices = new Map();
  const users = people.filter((p) => p.userId);
  const customers = people.filter((p) => p.customerId);
  if (users.length + customers.length === 0) return choices;

  const rows = await prisma.notificationPreference.findMany({
    where: {
      category,
      OR: [
        ...users.map((p) => ({ userId: p.userId!, scope: p.scope })),
        ...customers.map((p) => ({ customerId: p.customerId!, scope: p.scope })),
      ],
    },
    select: { userId: true, customerId: true, scope: true, channel: true, enabled: true },
  });
  for (const row of rows) {
    const key = personKey(row);
    choices.set(key, { ...choices.get(key), [row.channel]: row.enabled });
  }
  return choices;
}

/** The decision for one channel: the event's default, unless the person chose otherwise. */
export function wants(fallback: ChannelDefault | undefined, choice: boolean | undefined): boolean {
  if (!fallback) return false;
  if (fallback === 'required') return true;
  return choice ?? fallback === 'on';
}
