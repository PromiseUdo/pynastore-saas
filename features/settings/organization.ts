'use server';

/*
 * features/settings/organization.ts
 *
 * Settings → General: the business's own details — name, logo, how customers
 * reach them, and the currency every amount in the workspace is written in.
 *
 * The online store's returns window is NOT here: it is already owned by
 * Settings → Delivery and returns (features/settings/delivery.ts), and one
 * field with two editors is one field too many (AGENTS §9).
 *
 * The slug is deliberately absent. It is the store's hostname
 * ({slug}.{ROOT_DOMAIN} and shop-{slug}.…), so renaming it would break every
 * link a customer saved; existing orgs are never renamed (AGENTS §7).
 *
 * Viewing needs `settings.view`; changing needs `settings.edit`.
 */
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { destroyAsset, isOrgAsset } from '@/lib/cloudinary/sign';

export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string };

export interface OrganizationSettings {
  name: string;
  slug: string;
  logoUrl: string | null;
  logoPublicId: string | null;
  currency: string;
  supportEmail: string | null;
  supportPhone: string | null;
  businessAddress: string | null;
}

export type OrganizationFieldErrors = Partial<
  Record<'name' | 'supportEmail' | 'supportPhone' | 'businessAddress', string>
>;

const OrganizationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Enter your business name')
    .max(80, 'Keep the business name under 80 characters'),
  logo: z.object({ url: z.string().url(), publicId: z.string() }).nullable().optional(),
  supportEmail: z
    .string()
    .trim()
    .max(160, 'Keep the email under 160 characters')
    .email('Enter a valid email address')
    .or(z.literal(''))
    .optional(),
  supportPhone: z.string().trim().max(32, 'Keep the phone number under 32 characters').optional(),
  businessAddress: z.string().trim().max(300, 'Keep the address under 300 characters').optional(),
});

export type OrganizationInput = z.input<typeof OrganizationSchema>;

function failure(error: unknown, fallback: string): { success: false; error: string } {
  if (error instanceof Error && error.name === 'PermissionDeniedError') {
    return { success: false, error: 'You don’t have permission to change these settings' };
  }
  console.error(`[settings] ${fallback}:`, error);
  return { success: false, error: fallback };
}

export async function getOrganizationSettings(): Promise<ActionResult<OrganizationSettings>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_VIEW);

    const org = await prisma.organization.findUnique({
      where: { id: ctx.organization.id },
      select: {
        name: true,
        slug: true,
        logoUrl: true,
        logoPublicId: true,
        currency: true,
        supportEmail: true,
        supportPhone: true,
        businessAddress: true,
      },
    });
    if (!org) return { success: false, error: 'We couldn’t load your business details' };

    return { success: true, data: org };
  } catch (error) {
    return failure(error, 'We couldn’t load your business details');
  }
}

export async function saveOrganizationSettings(
  input: OrganizationInput,
): Promise<ActionResult<void> | { success: false; error: string; fieldErrors: OrganizationFieldErrors }> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_EDIT);
    const organizationId = ctx.organization.id;

    const parsed = OrganizationSchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors: OrganizationFieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof OrganizationFieldErrors;
        if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      return { success: false, error: 'Check the highlighted fields', fieldErrors };
    }
    const data = parsed.data;

    /* An image reference from the browser is only trusted once it is shown to
     * live in this org's own Cloudinary folder. */
    if (data.logo && !isOrgAsset(data.logo, organizationId)) {
      return { success: false, error: 'That logo wasn’t uploaded through this workspace. Remove it and upload it again.' };
    }

    const current = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { logoPublicId: true },
    });

    const logoUrl = data.logo?.url ?? null;
    const logoPublicId = data.logo?.publicId ?? null;

    await prisma.organization.update({
      where: { id: organizationId },
      data: {
        name: data.name,
        logoUrl,
        logoPublicId,
        supportEmail: data.supportEmail?.trim() || null,
        supportPhone: data.supportPhone?.trim() || null,
        businessAddress: data.businessAddress?.trim() || null,
      },
    });

    /* Replaced or removed: drop the old file. Best-effort — a leftover asset
     * is cheaper than a failed save. */
    if (current?.logoPublicId && current.logoPublicId !== logoPublicId) {
      await destroyAsset(current.logoPublicId);
    }

    await createAuditLog({
      organizationId,
      userId: ctx.userId,
      action: 'settings.organization.update',
      entityType: 'Organization',
      entityId: organizationId,
      metadata: {
        name: data.name,
        logoChanged: (current?.logoPublicId ?? null) !== logoPublicId,
      },
    });

    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t save your business details');
  }
}
