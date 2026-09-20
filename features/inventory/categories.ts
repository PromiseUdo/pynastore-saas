'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { type ActionResult, toActionError } from './shared';
import {
  MAX_COMPANIONS,
  SLUG_PATTERN,
  compareSiblings,
  parentProblem,
  slugify,
  uniqueSlug,
  type CategoryNodeInput,
} from './category-tree';

export type CategoryWithCounts = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  description: string | null;
  imageUrl: string | null;
  isVisible: boolean;
  isFeatured: boolean;
  sortOrder: number;
  /** "Goes well with" categories, best first */
  companionIds: string[];
  companionTitle: string | null;
  /** items filed directly in this category (not its subcategories) */
  itemCount: number;
};

const CategorySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80, 'Name must be 80 characters or less'),
  parentId: z.string().cuid().nullish(),
  /** omitted/empty = generate from the name */
  slug: z
    .string()
    .trim()
    .max(60, 'URL name must be 60 characters or less')
    .regex(SLUG_PATTERN, 'Use lowercase letters, numbers and single hyphens only')
    .or(z.literal(''))
    .optional(),
  description: z.string().trim().max(500, 'Description must be 500 characters or less').optional(),
  imageUrl: z
    .string()
    .trim()
    .url('Enter a full image link starting with https://')
    .refine((v) => v.startsWith('https://') || v.startsWith('http://'), 'Enter a full image link starting with https://')
    .or(z.literal(''))
    .optional(),
  isVisible: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  /* Omitted = leave as they are, so a caller that only toggles visibility
   * can't wipe the merchant's pairings. */
  companionIds: z.array(z.string().cuid()).max(MAX_COMPANIONS, `Pick up to ${MAX_COMPANIONS} categories`).optional(),
  companionTitle: z.string().trim().max(40, 'Heading must be 40 characters or less').optional(),
});

export type CategoryInput = z.input<typeof CategorySchema>;

/**
 * The pairings to store: this org's categories only, never the category
 * itself, no repeats, order kept. A foreign or deleted id is dropped rather
 * than refused — the list is a preference, not a record.
 */
function cleanCompanions(rows: CategoryNodeInput[], categoryId: string | null, ids: string[]): string[] {
  const ours = new Set(rows.map((r) => r.id));
  return [...new Set(ids)].filter((id) => id !== categoryId && ours.has(id));
}

const CATEGORY_SELECT = {
  id: true,
  name: true,
  slug: true,
  parentId: true,
  description: true,
  imageUrl: true,
  isVisible: true,
  isFeatured: true,
  sortOrder: true,
  companionIds: true,
  companionTitle: true,
} as const;

function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Please check the form';
}

async function loadOrgCategories(organizationId: string): Promise<CategoryNodeInput[]> {
  return prisma.category.findMany({
    where: { organizationId },
    select: { id: true, name: true, slug: true, parentId: true, sortOrder: true },
  });
}

/** Sibling clash checks the DB's unique index can't express (case-insensitive
 *  names; top-level rows, where parentId is NULL and Postgres treats NULLs as
 *  distinct). Returns the slug to store. */
function resolveNameAndSlug(
  rows: CategoryNodeInput[],
  opts: { categoryId: string | null; parentId: string | null; name: string; slug?: string },
): { slug: string } | { error: string } {
  const siblings = rows.filter((r) => r.parentId === opts.parentId && r.id !== opts.categoryId);

  if (siblings.some((s) => s.name.toLowerCase() === opts.name.toLowerCase())) {
    return { error: `There’s already a “${opts.name}” category at this level.` };
  }

  const taken = siblings.map((s) => s.slug);
  if (opts.slug) {
    if (taken.includes(opts.slug)) {
      return { error: `The URL name “${opts.slug}” is already used by another category at this level.` };
    }
    return { slug: opts.slug };
  }
  return { slug: uniqueSlug(slugify(opts.name), taken) };
}

export async function listCategories(): Promise<ActionResult<CategoryWithCounts[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_VIEW);

    const categories = await prisma.category.findMany({
      where: { organizationId: ctx.organization.id },
      select: { ...CATEGORY_SELECT, _count: { select: { items: { where: { parentItemId: null } } } } },
    });

    return {
      success: true,
      data: categories.sort(compareSiblings).map(({ _count, ...c }) => ({ ...c, itemCount: _count.items })),
    };
  } catch (err) {
    return toActionError(err, 'Failed to load categories');
  }
}

export async function createCategory(input: CategoryInput): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_CATEGORY_MANAGE);

    const parsed = CategorySchema.safeParse(input);
    if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };
    const data = parsed.data;
    const parentId = data.parentId ?? null;

    const rows = await loadOrgCategories(ctx.organization.id);
    const problem = parentProblem(rows, null, parentId);
    if (problem) return { success: false, error: problem };

    const resolved = resolveNameAndSlug(rows, { categoryId: null, parentId, name: data.name, slug: data.slug || undefined });
    if ('error' in resolved) return { success: false, error: resolved.error };

    const lastSibling = Math.max(-1, ...rows.filter((r) => r.parentId === parentId).map((r) => r.sortOrder));

    const category = await prisma.category.create({
      data: {
        organizationId: ctx.organization.id,
        name: data.name,
        slug: resolved.slug,
        parentId,
        description: data.description || null,
        imageUrl: data.imageUrl || null,
        isVisible: data.isVisible,
        // Only top-level categories are promoted in storefront navigation.
        isFeatured: parentId === null && data.isFeatured,
        sortOrder: lastSibling + 1,
        companionIds: cleanCompanions(rows, null, data.companionIds ?? []),
        companionTitle: data.companionTitle || null,
      },
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'inventory.category.created',
      entityType: 'Category',
      entityId: category.id,
      metadata: { name: data.name, parentId },
    });

    return { success: true, data: { id: category.id } };
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as { code?: string }).code === 'P2002') {
      return { success: false, error: 'A category with this name or URL name already exists at this level' };
    }
    return toActionError(err, 'Failed to create category');
  }
}

export async function updateCategory(categoryId: string, input: CategoryInput): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_CATEGORY_MANAGE);

    const parsed = CategorySchema.safeParse(input);
    if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };
    const data = parsed.data;
    const parentId = data.parentId ?? null;

    const existing = await prisma.category.findUnique({
      where: { id: categoryId },
      select: { organizationId: true, parentId: true, slug: true },
    });
    if (!existing || existing.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Category not found' };
    }

    const rows = await loadOrgCategories(ctx.organization.id);
    const problem = parentProblem(rows, categoryId, parentId);
    if (problem) return { success: false, error: problem };

    // Keep the existing URL when the user didn't touch it — a rename alone
    // shouldn't break links customers have bookmarked or shared.
    const moved = existing.parentId !== parentId;
    const requestedSlug = data.slug || (moved ? undefined : existing.slug);
    const resolved = resolveNameAndSlug(rows, { categoryId, parentId, name: data.name, slug: requestedSlug });
    if ('error' in resolved) return { success: false, error: resolved.error };

    const sortOrder = moved
      ? Math.max(-1, ...rows.filter((r) => r.parentId === parentId && r.id !== categoryId).map((r) => r.sortOrder)) + 1
      : undefined;

    await prisma.category.update({
      where: { id: categoryId },
      data: {
        name: data.name,
        slug: resolved.slug,
        parentId,
        description: data.description || null,
        imageUrl: data.imageUrl || null,
        isVisible: data.isVisible,
        isFeatured: parentId === null && data.isFeatured,
        sortOrder,
        ...(data.companionIds !== undefined && { companionIds: cleanCompanions(rows, categoryId, data.companionIds) }),
        ...(data.companionTitle !== undefined && { companionTitle: data.companionTitle || null }),
      },
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'inventory.category.updated',
      entityType: 'Category',
      entityId: categoryId,
      metadata: { name: data.name, parentId, moved },
    });

    return { success: true, data: undefined };
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as { code?: string }).code === 'P2002') {
      return { success: false, error: 'A category with this name or URL name already exists at this level' };
    }
    return toActionError(err, 'Failed to update category');
  }
}

/** Swap a category with its neighbour among siblings. */
export async function moveCategory(categoryId: string, direction: 'up' | 'down'): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_CATEGORY_MANAGE);

    const rows = await loadOrgCategories(ctx.organization.id);
    const target = rows.find((r) => r.id === categoryId);
    if (!target) return { success: false, error: 'Category not found' };

    const siblings = rows.filter((r) => r.parentId === target.parentId).sort(compareSiblings);
    const index = siblings.findIndex((s) => s.id === categoryId);
    const swapWith = direction === 'up' ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= siblings.length) return { success: true, data: undefined };

    [siblings[index], siblings[swapWith]] = [siblings[swapWith], siblings[index]];

    // Renumber the whole sibling group so ties (e.g. equal sortOrder, ordered
    // by name) can't make a move appear to do nothing.
    await prisma.$transaction(
      siblings.map((s, i) => prisma.category.update({ where: { id: s.id }, data: { sortOrder: i } })),
    );

    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to reorder category');
  }
}

export async function deleteCategory(categoryId: string): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_CATEGORY_MANAGE);

    const category = await prisma.category.findUnique({
      where: { id: categoryId },
      select: {
        organizationId: true,
        name: true,
        _count: { select: { items: true, children: true } },
      },
    });
    if (!category || category.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Category not found' };
    }
    if (category._count.children > 0) {
      return { success: false, error: 'Move or delete its subcategories first.' };
    }
    if (category._count.items > 0) {
      return { success: false, error: 'Move its items to another category first.' };
    }

    await prisma.category.delete({ where: { id: categoryId } });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'inventory.category.deleted',
      entityType: 'Category',
      entityId: categoryId,
      metadata: { name: category.name },
    });

    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to delete category');
  }
}
