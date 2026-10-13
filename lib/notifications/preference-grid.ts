/*
 * lib/notifications/preference-grid.ts
 *
 * What a person can choose about their notifications (ROADMAP 18.6): one row
 * per category that can reach them, and for each a choice for email and for
 * alerts on their devices (browser and phone together). The in-app list
 * always gets everything. Server only.
 *
 * The rows and their defaults come from the catalogue (./events.ts), never
 * from a second list, so a new kind shows up here by itself:
 *
 *   - a member sees the categories their permissions can receive; the
 *     Owner sees all of a shop's;
 *   - platform staff see the platform's (their email goes to the platform
 *     inbox, so only alerts are theirs to choose);
 *   - a shopper sees their orders and messages.
 *
 * Only a choice that differs from the default is stored (./preferences.ts);
 * turning one back to the default deletes the row.
 */
import { prisma } from '@/lib/prisma';
import type { NotificationChannel } from '@/lib/generated/prisma/enums';
import { hasPermission } from '@/lib/permissions';
import { EVENTS, NOTIFICATION_CATEGORIES, type ChannelDefault, type NotificationCategory, type NotificationKind } from './events';
import { PLATFORM_SCOPE } from './recipients';

import type { ChannelGroup, PreferenceCell, PreferenceRow } from './view';

export type { ChannelGroup, PreferenceCell, PreferenceRow } from './view';
export type PreferenceAudience = 'staff' | 'platform' | 'shopper';

const GROUP_CHANNELS: Record<ChannelGroup, NotificationChannel[]> = { email: ['EMAIL'], push: ['WEB_PUSH', 'NATIVE_PUSH'] };

/** Whose choices: a member in a shop, platform staff, or a shopper in a shop. */
export type PreferenceOwner =
  | { audience: 'staff'; userId: string; organizationId: string; permissions: string[] }
  | { audience: 'platform'; userId: string }
  | { audience: 'shopper'; customerId: string; organizationId: string };


/** The strongest default among a category's kinds: required, then on, then a daily summary, then off. */
function combine(defaults: (ChannelDefault | undefined)[]): ChannelDefault | null {
  for (const level of ['required', 'on', 'digest', 'off'] as const) if (defaults.includes(level)) return level;
  return null;
}

function kindsFor(owner: PreferenceOwner): NotificationKind[] {
  return (Object.keys(EVENTS) as NotificationKind[]).filter((kind) => {
    const reaches = EVENTS[kind].reaches;
    if (owner.audience === 'shopper') return Boolean(reaches.shopper);
    if (owner.audience === 'platform') return Boolean(reaches.platform);
    return Boolean(reaches.staff && hasPermission(owner.permissions, reaches.staff));
  });
}

/** Each category this person can receive, with its default per channel group. */
export function preferenceDefaults(owner: PreferenceOwner): Map<NotificationCategory, Record<ChannelGroup, ChannelDefault | null>> {
  const byCategory = new Map<NotificationCategory, NotificationKind[]>();
  for (const kind of kindsFor(owner)) {
    const category = EVENTS[kind].category;
    byCategory.set(category, [...(byCategory.get(category) ?? []), kind]);
  }
  const out = new Map<NotificationCategory, Record<ChannelGroup, ChannelDefault | null>>();
  for (const [category, kinds] of byCategory) {
    const channel = (c: NotificationChannel) => kinds.map((k) => EVENTS[k].channels[c]);
    out.set(category, {
      // Platform staff's email goes to the platform inbox, not to them.
      email: owner.audience === 'platform' ? null : combine(channel('EMAIL')),
      push: combine([...channel('WEB_PUSH'), ...channel('NATIVE_PUSH')]),
    });
  }
  return out;
}

const who = (owner: PreferenceOwner) =>
  owner.audience === 'shopper'
    ? { customerId: owner.customerId, scope: owner.organizationId }
    : { userId: owner.userId, scope: owner.audience === 'platform' ? PLATFORM_SCOPE : owner.organizationId };

function cell(fallback: ChannelDefault | null, stored: boolean | undefined): PreferenceCell | null {
  if (!fallback) return null;
  if (fallback === 'required') return { kind: 'required', on: true };
  return { kind: fallback === 'digest' ? 'digest' : 'choice', on: stored ?? fallback !== 'off' };
}

export async function loadPreferenceGrid(owner: PreferenceOwner): Promise<PreferenceRow[]> {
  const defaults = preferenceDefaults(owner);
  const rows = await prisma.notificationPreference.findMany({ where: who(owner), select: { category: true, channel: true, enabled: true } });
  const stored = (category: string, channel: NotificationChannel) => rows.find((r) => r.category === category && r.channel === channel)?.enabled;

  return [...defaults.entries()]
    .sort(([a], [b]) => Object.keys(NOTIFICATION_CATEGORIES).indexOf(a) - Object.keys(NOTIFICATION_CATEGORIES).indexOf(b))
    .map(([category, d]) => ({
      category,
      label: NOTIFICATION_CATEGORIES[category].label,
      about: NOTIFICATION_CATEGORIES[category].about,
      email: cell(d.email, stored(category, 'EMAIL')),
      // Push is one switch for the browser and the phone; they're saved together.
      push: cell(d.push, stored(category, 'WEB_PUSH')),
    }));
}

export type SaveResult = 'saved' | 'not-yours' | 'required';

/** Turn one category's email or alerts on or off. Only categories this person can receive. */
export async function savePreference(owner: PreferenceOwner, category: string, group: ChannelGroup, enabled: boolean): Promise<SaveResult> {
  const defaults = preferenceDefaults(owner).get(category as NotificationCategory);
  const fallback = defaults?.[group];
  if (!defaults || !fallback) return 'not-yours';
  if (fallback === 'required') return 'required';

  const base = who(owner);
  const organizationId = owner.audience === 'platform' ? null : owner.organizationId;
  const isDefault = enabled === (fallback !== 'off');
  for (const channel of GROUP_CHANNELS[group]) {
    const where = { ...base, category, channel };
    if (isDefault) {
      await prisma.notificationPreference.deleteMany({ where });
      continue;
    }
    const updated = await prisma.notificationPreference.updateMany({ where, data: { enabled } });
    if (updated.count === 0) await prisma.notificationPreference.create({ data: { ...where, organizationId, enabled } });
  }
  return 'saved';
}
