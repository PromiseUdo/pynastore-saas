'use server';

/*
 * features/storefront/slides.ts
 *
 * The slides at the top of the shop's front page — Online store → Customize
 * → Front page slides. Moved here from Settings → Storefront in ROADMAP 15.1.
 *
 * Slides are CONTENT, so they save straight to the live shop, like products
 * and store pages. Only the design (look, colour, fonts) waits for Publish.
 *
 * Everything here is written and uploaded by the merchant; nothing is
 * generated. Needs `storefront.design`, to read as well as to change.
 */
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { destroyAsset, isOrgAsset } from '@/lib/cloudinary/sign';
import type { ActionResult } from '@/features/sales/shared';

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
    return { success: false, error: 'You don’t have permission to change your online store' };
  }
  console.error(`[storefront] ${fallback}:`, error);
  return { success: false, error: fallback };
}

export async function listHeroSlides(): Promise<ActionResult<HeroSlideRow[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.STOREFRONT_DESIGN);
    const slides = await prisma.storefrontHeroSlide.findMany({
      where: { organizationId: ctx.organization.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return {
      success: true,
      data: slides.map((slide) => ({
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
    };
  } catch (error) {
    return failure(error, 'We couldn’t load your slides');
  }
}

export async function saveHeroSlide(slideId: string | null, input: SlideInput): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.STOREFRONT_DESIGN);
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
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.STOREFRONT_DESIGN);

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
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.STOREFRONT_DESIGN);
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
