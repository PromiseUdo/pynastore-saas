'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { destroyAsset, isOrgAsset } from '@/lib/cloudinary/sign';
import { type ActionResult, toActionError } from './shared';
import { SLUG_PATTERN, slugify, uniqueSlug } from './category-tree';

export type BrandRow = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  logoPublicId: string | null;
  description: string | null;
  productCount: number;
  /** products customers can see right now */
  publishedCount: number;
};

export async function listBrands(): Promise<ActionResult<BrandRow[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_VIEW);

    const brands = await prisma.brand.findMany({
      where: { organizationId: ctx.organization.id },
      select: {
        id: true,
        name: true,
        slug: true,
        logoUrl: true,
        logoPublicId: true,
        description: true,
        _count: { select: { items: { where: { parentItemId: null } } } },
      },
      orderBy: { name: 'asc' },
    });

    const published = await prisma.inventoryItem.groupBy({
      by: ['brandId'],
      where: { organizationId: ctx.organization.id, parentItemId: null, brandId: { not: null }, isPublished: true },
      _count: { _all: true },
    });
    const publishedByBrand = new Map(published.map((p) => [p.brandId!, p._count._all]));

    return {
      success: true,
      data: brands.map(({ _count, ...b }) => ({
        ...b,
        productCount: _count.items,
        publishedCount: publishedByBrand.get(b.id) ?? 0,
      })),
    };
  } catch (err) {
    return toActionError(err, 'Failed to load brands');
  }
}

const NameSchema = z.string().trim().min(1, 'Brand name is required').max(80, 'Brand name must be 80 characters or less');

const BrandSchema = z.object({
  name: NameSchema,
  slug: z.string().trim().max(80).default(''),
  description: z.string().trim().max(500, 'Description must be 500 characters or less').nullish(),
  logo: z.object({ url: z.string().url(), publicId: z.string().min(1) }).nullish(),
});

export type BrandInput = z.input<typeof BrandSchema>;

/** Either permission may manage brands: creating products implies naming their makers. */
function canManageBrands(permissions: string[]): boolean {
  return (
    hasPermission(permissions, PERMISSIONS.INVENTORY_CATEGORY_MANAGE) || hasPermission(permissions, PERMISSIONS.INVENTORY_CREATE)
  );
}

/** `data.slug` empty means "keep the current web address", or generate one for a new record —
 *  renaming alone must not break links customers have saved. */
function checkSlugAndName(
  siblings: { id: string; name: string; slug: string }[],
  data: { name: string; slug: string },
  existingId: string | null,
): { error: string } | { slug: string } {
  const others = siblings.filter((b) => b.id !== existingId);
  const current = existingId ? siblings.find((b) => b.id === existingId)?.slug : undefined;
  if (others.some((b) => b.name.toLowerCase() === data.name.toLowerCase())) {
    return { error: `You already have a brand called “${data.name}”.` };
  }
  if (data.slug) {
    if (!SLUG_PATTERN.test(data.slug)) return { error: 'The web address can only use lowercase letters, numbers and single hyphens.' };
    if (others.some((b) => b.slug === data.slug)) return { error: `The web address “${data.slug}” is already used by another brand.` };
    return { slug: data.slug };
  }
  if (current) return { slug: current };
  return { slug: uniqueSlug(slugify(data.name), others.map((b) => b.slug)) };
}

export async function saveBrand(brandId: string | null, input: BrandInput): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await getOrganizationContext();
    if (!canManageBrands(ctx.membership.role.permissions)) {
      return { success: false, error: 'You do not have permission to do this' };
    }
    const organizationId = ctx.organization.id;

    const parsed = BrandSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };
    const data = parsed.data;

    if (data.logo && !isOrgAsset(data.logo, organizationId)) {
      return { success: false, error: 'That logo wasn’t uploaded through this workspace. Remove it and upload it again.' };
    }

    const siblings = await prisma.brand.findMany({ where: { organizationId }, select: { id: true, name: true, slug: true } });
    const checked = checkSlugAndName(siblings, { name: data.name, slug: data.slug }, brandId);
    if ('error' in checked) return { success: false, error: checked.error };

    const fields = {
      name: data.name,
      slug: checked.slug,
      description: data.description || null,
      logoUrl: data.logo?.url ?? null,
      logoPublicId: data.logo?.publicId ?? null,
    };

    const isNew = brandId === null;
    let savedId = brandId;
    if (brandId) {
      const existing = await prisma.brand.findFirst({ where: { id: brandId, organizationId }, select: { logoPublicId: true } });
      if (!existing) return { success: false, error: 'Brand not found' };
      await prisma.brand.update({ where: { id: brandId }, data: fields });
      if (existing.logoPublicId && existing.logoPublicId !== fields.logoPublicId) void destroyAsset(existing.logoPublicId);
    } else {
      const created = await prisma.brand.create({ data: { organizationId, ...fields } });
      savedId = created.id;
    }

    await createAuditLog({
      organizationId,
      userId: ctx.userId,
      action: isNew ? 'inventory.brand.created' : 'inventory.brand.updated',
      entityType: 'Brand',
      entityId: savedId!,
      metadata: { name: data.name },
    });

    return { success: true, data: { id: savedId! } };
  } catch (err) {
    return toActionError(err, 'Failed to save brand');
  }
}

/** Products keep existing; they simply lose their brand. */
export async function deleteBrand(brandId: string): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    if (!canManageBrands(ctx.membership.role.permissions)) {
      return { success: false, error: 'You do not have permission to do this' };
    }

    const existing = await prisma.brand.findFirst({
      where: { id: brandId, organizationId: ctx.organization.id },
      select: { name: true, logoPublicId: true },
    });
    if (!existing) return { success: false, error: 'Brand not found' };

    await prisma.brand.delete({ where: { id: brandId } });
    if (existing.logoPublicId) void destroyAsset(existing.logoPublicId);

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'inventory.brand.deleted',
      entityType: 'Brand',
      entityId: brandId,
      metadata: { name: existing.name },
    });

    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to delete brand');
  }
}

/** Quick-create from the product form. Returns the existing brand when the name already exists. */
export async function createBrand(name: string): Promise<ActionResult<BrandRow>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_CREATE);

    const parsed = NameSchema.safeParse(name);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };

    const existing = await prisma.brand.findMany({
      where: { organizationId: ctx.organization.id },
      select: { id: true, name: true, slug: true, logoUrl: true, logoPublicId: true, description: true },
    });
    const match = existing.find((b) => b.name.toLowerCase() === parsed.data.toLowerCase());
    if (match) return { success: true, data: { ...match, productCount: 0, publishedCount: 0 } };

    const brand = await prisma.brand.create({
      data: {
        organizationId: ctx.organization.id,
        name: parsed.data,
        slug: uniqueSlug(slugify(parsed.data), existing.map((b) => b.slug)),
      },
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'inventory.brand.created',
      entityType: 'Brand',
      entityId: brand.id,
      metadata: { name: brand.name },
    });

    return {
      success: true,
      data: { id: brand.id, name: brand.name, slug: brand.slug, logoUrl: null, logoPublicId: null, description: null, productCount: 0, publishedCount: 0 },
    };
  } catch (err) {
    return toActionError(err, 'Failed to create brand');
  }
}
