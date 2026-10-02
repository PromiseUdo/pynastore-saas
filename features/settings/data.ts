'use server';

/*
 * features/settings/data.ts
 *
 * Settings → Your data (ROADMAP 13.8): closing the workspace. Owners only —
 * it takes the shop offline and, after the grace period, deletes it; see
 * lib/data-rights/workspace.ts for exactly what happens and when.
 */
import { getOrganizationContext } from '@/lib/organization';
import { SYSTEM_ROLES } from '@/lib/permissions';
import { closeWorkspace, WorkspaceClosureError } from '@/lib/data-rights/workspace';
import { getMarketingUrl } from '@/lib/tenant/urls';

export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string };

/**
 * On success, returns where to send the browser: the platform's home page,
 * on another host. The client goes there itself — a server-action redirect
 * to a different host is handled poorly by the router.
 */
export async function closeWorkspaceAction(input: { confirmName: string; reason?: string }): Promise<ActionResult<{ next: string }>> {
  const ctx = await getOrganizationContext();
  const role = ctx.membership.role;
  if (!(role.isSystem && role.name === SYSTEM_ROLES.OWNER.name)) {
    return { success: false, error: 'Only an Owner can close the workspace.' };
  }
  try {
    await closeWorkspace({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      confirmName: String(input.confirmName ?? ''),
      reason: input.reason ? String(input.reason) : null,
    });
  } catch (error) {
    if (error instanceof WorkspaceClosureError) return { success: false, error: error.message };
    console.error('[settings/data] closing failed', error);
    return { success: false, error: 'We couldn’t close the workspace. Nothing has changed — please try again.' };
  }
  return { success: true, data: { next: getMarketingUrl('/') } };
}
