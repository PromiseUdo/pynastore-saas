'use server';

/*
 * features/onboarding/actions.ts
 *
 * Opening and closing the shop to customers, and hiding the setup guide
 * (ROADMAP 12.5). Opening is refused until every required step is done —
 * checked here against the real records (lib/onboarding/setup-guide.ts),
 * whatever the screen showed.
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { PermissionDeniedError, PERMISSIONS, requirePermission } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { getSetupProgress } from '@/lib/onboarding/setup-guide';

export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string };

function failure(error: unknown, fallback: string): { success: false; error: string } {
  if (error instanceof PermissionDeniedError) return { success: false, error: 'You don’t have permission to do this.' };
  console.error(`[onboarding] ${fallback}:`, error);
  return { success: false, error: fallback };
}

export async function openStorefront(): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_EDIT);
    const progress = await getSetupProgress(ctx.organization.id);
    if (!progress) return { success: false, error: 'We couldn’t check your setup. Try again.' };
    if (!progress.readyToOpen) {
      const missing = progress.steps.filter((s) => s.required && !s.done).map((s) => s.title.toLowerCase());
      return { success: false, error: `Your shop can’t open yet — first: ${missing.join('; ')}.` };
    }
    const updated = await prisma.organization.updateMany({
      where: { id: ctx.organization.id, storefrontOpen: false },
      data: { storefrontOpen: true, storefrontOpenedAt: new Date() },
    });
    if (updated.count > 0) {
      await createAuditLog({
        organizationId: ctx.organization.id,
        userId: ctx.userId,
        action: 'settings.storefront.opened',
        entityType: 'Organization',
        entityId: ctx.organization.id,
      });
    }
    revalidatePath('/', 'layout');
    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t open your shop. Try again.');
  }
}

/** Closes the shop again — say for a holiday. Nothing is lost; open it again any time. */
export async function closeStorefront(): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_EDIT);
    const updated = await prisma.organization.updateMany({
      where: { id: ctx.organization.id, storefrontOpen: true },
      data: { storefrontOpen: false },
    });
    if (updated.count > 0) {
      await createAuditLog({
        organizationId: ctx.organization.id,
        userId: ctx.userId,
        action: 'settings.storefront.closed',
        entityType: 'Organization',
        entityId: ctx.organization.id,
      });
    }
    revalidatePath('/', 'layout');
    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t close your shop. Try again.');
  }
}

/** Hides the guide from the dashboard (it stays in Settings), or brings it back. */
export async function setSetupGuideHidden(hidden: boolean): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_EDIT);
    await prisma.organization.update({
      where: { id: ctx.organization.id },
      data: { setupGuideDismissedAt: hidden ? new Date() : null },
    });
    revalidatePath('/', 'layout');
    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t change that. Try again.');
  }
}
