'use server';

/*
 * features/settings/storefront.ts
 *
 * Settings → Storefront: how the shop appears in search results and when
 * its link is shared, and the merchant's own tracking ids.
 *
 * The LOOK (colour, fonts, light/dark) and the front-page slides moved to
 * Online store → Customize in ROADMAP 15.1 — features/storefront/design.ts
 * and features/storefront/slides.ts — under their own permission. The old
 * `storefrontAccent` and `storefrontDarkByDefault` columns are only read now,
 * as the starting point for a shop that has never published a design.
 *
 * Everything here is the merchant's own — written, uploaded, or pasted in
 * from their own analytics account. Nothing is generated, and an empty field
 * means the storefront's own default, not a sentence invented for them
 * (AGENTS: never invent a merchant's content).
 *
 * Needs `settings.edit` to change, `settings.view` to read.
 */
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { destroyAsset, isOrgAsset } from '@/lib/cloudinary/sign';
import type { ActionResult } from '@/features/sales/shared';

/* Measurement ids as the provider writes them, so a merchant can paste
 * straight from their own dashboard and be told if it looks wrong. */
const GA_ID = /^(G-[A-Z0-9]{4,}|UA-\d{4,}-\d+)$/i;
const PIXEL_ID = /^\d{8,20}$/;

const AppearanceSchema = z.object({
  tagline: z.string().trim().max(200, 'Keep it under 200 characters').optional(),
  socialImage: z.object({ url: z.string().url(), publicId: z.string() }).nullable().optional(),
  gaId: z
    .string()
    .trim()
    .refine((v) => !v || GA_ID.test(v), 'A Google measurement id looks like G-XXXXXXX')
    .optional(),
  metaPixelId: z
    .string()
    .trim()
    .refine((v) => !v || PIXEL_ID.test(v), 'A Meta pixel id is a long number')
    .optional(),
});

export type AppearanceInput = z.input<typeof AppearanceSchema>;

export interface StorefrontAppearance {
  tagline: string | null;
  socialImageUrl: string | null;
  socialImagePublicId: string | null;
  gaId: string | null;
  metaPixelId: string | null;
}


function failure(error: unknown, fallback: string): { success: false; error: string } {
  if (error instanceof Error && error.name === 'PermissionDeniedError') {
    return { success: false, error: 'You don’t have permission to change your storefront' };
  }
  console.error(`[storefront] ${fallback}:`, error);
  return { success: false, error: fallback };
}

export async function getStorefrontAppearance(): Promise<ActionResult<{ appearance: StorefrontAppearance }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_VIEW);

    const org = await prisma.organization.findUnique({
      where: { id: ctx.organization.id },
      select: {
        storefrontTagline: true,
        storefrontSocialImageUrl: true,
        storefrontSocialImagePublicId: true,
        analyticsGaId: true,
        analyticsMetaPixelId: true,
      },
    });
    if (!org) return { success: false, error: 'We couldn’t load your storefront settings' };

    return {
      success: true,
      data: {
        appearance: {
          tagline: org.storefrontTagline,
          socialImageUrl: org.storefrontSocialImageUrl,
          socialImagePublicId: org.storefrontSocialImagePublicId,
          gaId: org.analyticsGaId,
          metaPixelId: org.analyticsMetaPixelId,
        },
      },
    };
  } catch (error) {
    return failure(error, 'We couldn’t load your storefront settings');
  }
}

export async function saveStorefrontAppearance(input: AppearanceInput): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_EDIT);
    const organizationId = ctx.organization.id;

    const parsed = AppearanceSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };
    const data = parsed.data;

    if (data.socialImage && !isOrgAsset(data.socialImage, organizationId)) {
      return {
        success: false,
        error: 'That image wasn’t uploaded through this workspace. Remove it and upload it again.',
      };
    }

    const previous = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { storefrontSocialImagePublicId: true },
    });

    await prisma.organization.update({
      where: { id: organizationId },
      data: {
        storefrontTagline: data.tagline?.trim() || null,
        storefrontSocialImageUrl: data.socialImage?.url ?? null,
        storefrontSocialImagePublicId: data.socialImage?.publicId ?? null,
        analyticsGaId: data.gaId?.trim() || null,
        analyticsMetaPixelId: data.metaPixelId?.trim() || null,
      },
    });

    const wasPublicId = previous?.storefrontSocialImagePublicId ?? null;
    if (wasPublicId && wasPublicId !== (data.socialImage?.publicId ?? null)) {
      await destroyAsset(wasPublicId);
    }

    await createAuditLog({
      organizationId,
      userId: ctx.userId,
      action: 'settings.storefront.updated',
      entityType: 'Organization',
      entityId: organizationId,
      metadata: { analytics: Boolean(data.gaId || data.metaPixelId) },
    });

    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t save your storefront settings');
  }
}
