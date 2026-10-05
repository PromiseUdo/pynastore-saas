'use server';

/*
 * features/mobile-app/actions.ts
 *
 * Settings → Mobile app (ROADMAP 16.2): asking for the store's own app,
 * paying for it, renewing it, and whether the website offers it. The store
 * comes from the session, never from the form.
 *
 * Telling us about the app needs `settings.edit`; paying needs
 * `billing.manage`, as for a domain.
 */
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS, PermissionDeniedError } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { isOrgAsset } from '@/lib/cloudinary/sign';
import {
  checkMobileAppRequest,
  MobileAppOrderError,
  saveMobileAppRequest,
  startMobileAppCheckout,
  type MobileAppRequestInput,
  type RequestErrors,
} from '@/lib/mobile/orders';

type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: RequestErrors };

function failure(error: unknown, fallback: string): { success: false; error: string } {
  if (error instanceof PermissionDeniedError) return { success: false, error: 'You don’t have permission to do this.' };
  if (error instanceof MobileAppOrderError) return { success: false, error: error.message };
  console.error(`[mobile-app] ${fallback}:`, error);
  return { success: false, error: fallback };
}

/** Saves what the app should be. Allowed until staff start building it. */
export async function saveMobileAppRequestAction(input: MobileAppRequestInput): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_EDIT);
    const request: MobileAppRequestInput = {
      name: String(input?.name ?? '').slice(0, 200),
      icon: input?.icon ?? null,
      backgroundColor: String(input?.backgroundColor ?? ''),
      shortDescription: String(input?.shortDescription ?? '').slice(0, 500),
      wantsAndroid: input?.wantsAndroid === true,
      wantsIos: input?.wantsIos === true,
    };

    const fieldErrors = checkMobileAppRequest(request);
    // Only an image this store uploaded through us.
    if (request.icon && !isOrgAsset(request.icon, ctx.organization.id)) fieldErrors.icon = 'Upload the icon again.';
    if (Object.keys(fieldErrors).length) return { success: false, error: 'Check the highlighted fields.', fieldErrors };

    const { id } = await saveMobileAppRequest({
      organizationId: ctx.organization.id,
      slug: ctx.organization.slug,
      userId: ctx.userId,
      request,
    });
    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'settings.mobile_app.requested',
      entityType: 'MobileApp',
      entityId: id,
      metadata: { name: request.name.trim(), android: request.wantsAndroid, ios: request.wantsIos },
    });
    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t save your app’s details. Try again.');
  }
}

/** Starts paying: the setup fee, or a year's renewal. The price is read on the server. */
export async function payForMobileAppAction(kind: 'SETUP' | 'RENEWAL'): Promise<ActionResult<{ authorizationUrl: string }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.BILLING_MANAGE);
    const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { email: true } });
    if (!user) return { success: false, error: 'We couldn’t find your account.' };
    const result = await startMobileAppCheckout({
      organizationId: ctx.organization.id,
      organizationSlug: ctx.organization.slug,
      userId: ctx.userId,
      userEmail: user.email,
      kind: kind === 'RENEWAL' ? 'RENEWAL' : 'SETUP',
    });
    return { success: true, data: result };
  } catch (error) {
    return failure(error, 'We couldn’t start the payment. Try again.');
  }
}

/** Withdraws a request that was never paid for. */
export async function cancelMobileAppRequestAction(): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_EDIT);
    const app = await prisma.mobileApp.findUnique({
      where: { organizationId: ctx.organization.id },
      select: { id: true, stage: true, payments: { where: { paidAt: { not: null } }, select: { id: true } } },
    });
    if (!app) return { success: true, data: undefined };
    if (app.stage !== 'REQUESTED' || app.payments.length) {
      return { success: false, error: 'Your app is already paid for, so it can’t be withdrawn here. Contact us.' };
    }
    await prisma.mobileApp.delete({ where: { id: app.id } });
    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'settings.mobile_app.withdrawn',
      entityType: 'MobileApp',
      entityId: app.id,
    });
    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t withdraw your request. Try again.');
  }
}

/** Whether the store's website offers the app ("Get our app", ROADMAP 16.4). */
export async function setAppPromotionAction(on: boolean): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_EDIT);
    const updated = await prisma.mobileApp.updateMany({
      where: { organizationId: ctx.organization.id },
      data: { promoteOnWebsite: on === true },
    });
    if (updated.count !== 1) return { success: false, error: 'Your store doesn’t have an app yet.' };
    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: on ? 'settings.mobile_app.promoted' : 'settings.mobile_app.unpromoted',
      entityType: 'MobileApp',
      entityId: ctx.organization.id,
    });
    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t save that. Try again.');
  }
}
