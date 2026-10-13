'use server';

/*
 * features/notifications/actions.ts
 *
 * A member, or platform staff, choosing what reaches them by email and on
 * their devices (ROADMAP 18.6). Whose choice it is comes from the session —
 * the shop from the host, the member from their membership — never from the
 * browser; the category must be one they can receive (lib/notifications/
 * preference-grid.ts).
 */
import { getOrganizationContext } from '@/lib/organization';
import { requirePlatformStaff } from '@/lib/platform-staff';
import { savePreference, type ChannelGroup, type SaveResult } from '@/lib/notifications/preference-grid';

const GROUPS: ChannelGroup[] = ['email', 'push'];

const MESSAGES: Record<Exclude<SaveResult, 'saved'>, string> = {
  'not-yours': 'That isn’t something you get notifications about.',
  required: 'These are always sent.',
};

type Result = { success: true } | { success: false; error: string };

function answer(result: SaveResult): Result {
  return result === 'saved' ? { success: true } : { success: false, error: MESSAGES[result] };
}

export async function setMyNotificationPreference(category: string, group: string, enabled: boolean): Promise<Result> {
  if (!GROUPS.includes(group as ChannelGroup)) return { success: false, error: 'Unknown channel.' };
  try {
    const ctx = await getOrganizationContext();
    return answer(
      await savePreference(
        { audience: 'staff', userId: ctx.userId, organizationId: ctx.organization.id, permissions: ctx.membership.role.permissions },
        String(category),
        group as ChannelGroup,
        Boolean(enabled),
      ),
    );
  } catch (error) {
    console.error('[notifications] Couldn’t save a preference:', error);
    return { success: false, error: 'We couldn’t save that. Please try again.' };
  }
}

export async function setPlatformNotificationPreference(category: string, group: string, enabled: boolean): Promise<Result> {
  if (!GROUPS.includes(group as ChannelGroup)) return { success: false, error: 'Unknown channel.' };
  try {
    const staff = await requirePlatformStaff();
    return answer(await savePreference({ audience: 'platform', userId: staff.userId }, String(category), group as ChannelGroup, Boolean(enabled)));
  } catch (error) {
    console.error('[notifications] Couldn’t save a preference:', error);
    return { success: false, error: 'We couldn’t save that. Please try again.' };
  }
}
