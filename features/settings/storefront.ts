'use server';

/*
 * features/settings/storefront.ts
 *
 * Settings → Storefront: what the merchant's own shop looks like, and how it
 * appears when someone links to it.
 *
 * WHY IT EXISTS: every storefront opened the same way. `getHomepageSections`
 * returned an empty hero because there was no table behind it, so a shop with
 * a story to tell had nowhere to tell it.
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
import { isHexColour } from '@/lib/marketing/announcement';
import type { ActionResult } from '@/features/sales/shared';

const HEX_OR_EMPTY = z
  .string()
  .trim()
  .regex(/^(#[0-9a-fA-F]{6})?$/, 'Use a colour like #b42318')
  .optional();

/* Measurement ids as the provider writes them, so a merchant can paste
 * straight from their own dashboard and be told if it looks wrong. */
const GA_ID = /^(G-[A-Z0-9]{4,}|UA-\d{4,}-\d+)$/i;
const PIXEL_ID = /^\d{8,20}$/;

const AppearanceSchema = z.object({
  accent: HEX_OR_EMPTY,
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
  accent: string | null;
  tagline: string | null;
  socialImageUrl: string | null;
  socialImagePublicId: string | null;
  gaId: string | null;
  metaPixelId: string | null;
}

export interface HeroSlideRow {
  id: string;
  eyebrow: string | null;
  title: string;
  subtitle: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  imageUrl: string | null;
  imagePublicId: string | null;
  align: string;
  theme: string;
  sortOrder: number;
  isVisible: boolean;
}

const SlideSchema = z.object({
  eyebrow: z.string().trim().max(40).optional(),
  title: z.string().trim().min(2, 'Give the slide a headline').max(80),
  subtitle: z.string().trim().max(160).optional(),
  ctaLabel: z.string().trim().max(40).optional(),
  ctaHref: z.string().trim().max(300).optional(),
  image: z.object({ url: z.string().url(), publicId: z.string() }).nullable().optional(),
  align: z.enum(['LEFT', 'CENTER', 'RIGHT']),
  theme: z.enum(['LIGHT', 'DARK']),
  isVisible: z.boolean(),
});

export type SlideInput = z.input<typeof SlideSchema>;

function failure(error: unknown, fallback: string): { success: false; error: string } {
  if (error instanceof Error && error.name === 'PermissionDeniedError') {
    return { success: false, error: 'You don’t have permission to change your storefront' };
  }
  console.error(`[storefront] ${fallback}:`, error);
  return { success: false, error: fallback };
}

export async function getStorefrontAppearance(): Promise<
  ActionResult<{ appearance: StorefrontAppearance; slides: HeroSlideRow[] }>
> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_VIEW);

    const [org, slides] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: ctx.organization.id },
        select: {
          storefrontAccent: true,
          storefrontTagline: true,
          storefrontSocialImageUrl: true,
          storefrontSocialImagePublicId: true,
          analyticsGaId: true,
          analyticsMetaPixelId: true,
        },
      }),
      prisma.storefrontHeroSlide.findMany({
        where: { organizationId: ctx.organization.id },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);
    if (!org) return { success: false, error: 'We couldn’t load your storefront settings' };

    return {
      success: true,
      data: {
        appearance: {
          accent: org.storefrontAccent,
          tagline: org.storefrontTagline,
          socialImageUrl: org.storefrontSocialImageUrl,
          socialImagePublicId: org.storefrontSocialImagePublicId,
          gaId: org.analyticsGaId,
          metaPixelId: org.analyticsMetaPixelId,
        },
        slides: slides.map((slide) => ({
          id: slide.id,
          eyebrow: slide.eyebrow,
          title: slide.title,
          subtitle: slide.subtitle,
          ctaLabel: slide.ctaLabel,
          ctaHref: slide.ctaHref,
          imageUrl: slide.imageUrl,
          imagePublicId: slide.imagePublicId,
          align: slide.align,
          theme: slide.theme,
          sortOrder: slide.sortOrder,
          isVisible: slide.isVisible,
        })),
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
        storefrontAccent: data.accent?.trim() || null,
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
      metadata: { accent: data.accent || null, analytics: Boolean(data.gaId || data.metaPixelId) },
    });

    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t save your storefront settings');
  }
}

export async function saveHeroSlide(slideId: string | null, input: SlideInput): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_EDIT);
    const organizationId = ctx.organization.id;

    const parsed = SlideSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };
    const data = parsed.data;

    if (data.image && !isOrgAsset(data.image, organizationId)) {
      return {
        success: false,
        error: 'That image wasn’t uploaded through this workspace. Remove it and upload it again.',
      };
    }
    /* A link needs both halves or it is not a link — the storefront would
     * otherwise render a button that goes nowhere. */
    if (data.ctaLabel?.trim() && !data.ctaHref?.trim()) {
      return { success: false, error: 'A button needs somewhere to go' };
    }
    if (data.ctaHref?.trim() && !data.ctaHref.trim().startsWith('/')) {
      return { success: false, error: 'A link has to be a page on your store, starting with /' };
    }

    const fields = {
      eyebrow: data.eyebrow?.trim() || null,
      title: data.title,
      subtitle: data.subtitle?.trim() || null,
      ctaLabel: data.ctaLabel?.trim() || null,
      ctaHref: data.ctaHref?.trim() || null,
      imageUrl: data.image?.url ?? null,
      imagePublicId: data.image?.publicId ?? null,
      align: data.align,
      theme: data.theme,
      isVisible: data.isVisible,
    };

    let id = slideId;
    if (slideId) {
      const existing = await prisma.storefrontHeroSlide.findFirst({
        where: { id: slideId, organizationId },
        select: { imagePublicId: true },
      });
      if (!existing) return { success: false, error: 'That slide no longer exists' };

      await prisma.storefrontHeroSlide.update({ where: { id: slideId }, data: fields });

      if (existing.imagePublicId && existing.imagePublicId !== fields.imagePublicId) {
        await destroyAsset(existing.imagePublicId);
      }
    } else {
      // New slides go to the end, where a merchant expects to find them.
      const last = await prisma.storefrontHeroSlide.findFirst({
        where: { organizationId },
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      });
      const created = await prisma.storefrontHeroSlide.create({
        data: { ...fields, organizationId, sortOrder: (last?.sortOrder ?? -1) + 1 },
        select: { id: true },
      });
      id = created.id;
    }

    await createAuditLog({
      organizationId,
      userId: ctx.userId,
      action: slideId ? 'settings.hero_slide.updated' : 'settings.hero_slide.created',
      entityType: 'StorefrontHeroSlide',
      entityId: id!,
      metadata: { title: data.title },
    });

    return { success: true, data: { id: id! } };
  } catch (error) {
    return failure(error, 'We couldn’t save that slide');
  }
}

export async function deleteHeroSlide(slideId: string): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_EDIT);

    const slide = await prisma.storefrontHeroSlide.findFirst({
      where: { id: slideId, organizationId: ctx.organization.id },
      select: { id: true, title: true, imagePublicId: true },
    });
    if (!slide) return { success: false, error: 'That slide no longer exists' };

    await prisma.storefrontHeroSlide.delete({ where: { id: slide.id } });
    if (slide.imagePublicId) await destroyAsset(slide.imagePublicId);

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'settings.hero_slide.deleted',
      entityType: 'StorefrontHeroSlide',
      entityId: slideId,
      metadata: { title: slide.title },
    });

    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t remove that slide');
  }
}

/** Move a slide up or down the order. */
export async function reorderHeroSlides(orderedIds: string[]): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_EDIT);
    const organizationId = ctx.organization.id;

    const owned = await prisma.storefrontHeroSlide.findMany({
      where: { organizationId },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((s) => s.id));
    /* Anything not this store's is dropped rather than refused: the order
     * that arrives is a view of the list, and a stale one shouldn't fail. */
    const ids = orderedIds.filter((id) => ownedIds.has(id));

    await prisma.$transaction(
      ids.map((id, index) =>
        prisma.storefrontHeroSlide.update({ where: { id }, data: { sortOrder: index } }),
      ),
    );

    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t reorder your slides');
  }
}
