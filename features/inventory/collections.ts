'use server';

// Collections — merchandising groups that cut across categories. CURATED
// holds an ordered list of products; DYNAMIC holds a rule that is resolved
// live, so it stays true as the catalog changes. Rules: ./collection-rules.ts.

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { destroyAsset, isOrgAsset } from '@/lib/cloudinary/sign';
import { CollectionKind, CollectionSort, ItemStatus } from '@/lib/generated/prisma/enums';
import type { Prisma } from '@/lib/generated/prisma/client';
import { type ActionResult, toActionError } from './shared';
import { SLUG_PATTERN, descendantIds, slugify, uniqueSlug } from './category-tree';
import { isProductTag } from './product-rules';
import { ruleProblem, type CollectionRule } from './collection-rules';

/* ─── Types ─────────────────────────────────────────────────────────────── */

export type CollectionProductRow = {
  id: string;
  name: string;
  sku: string;
  imageUrl: string | null;
  price: number | null;
  isPublished: boolean;
  status: ItemStatus;
};

export type CollectionListRow = {
  id: string;
  name: string;
  slug: string;
  tagline: string | null;
  kind: CollectionKind;
  isVisible: boolean;
  isFeatured: boolean;
  sortOrder: number;
  imageUrl: string | null;
  /** products the collection resolves to right now */
  productCount: number;
  /** how many of those customers can actually see */
  publishedCount: number;
};

export type CollectionDetail = CollectionRule & {
  id: string;
  name: string;
  slug: string;
  tagline: string | null;
  description: string | null;
  imageUrl: string | null;
  imagePublicId: string | null;
  heroImageUrl: string | null;
  heroPublicId: string | null;
  isVisible: boolean;
  isFeatured: boolean;
  kind: CollectionKind;
  sort: CollectionSort;
  /** curated: the members in editorial order. dynamic: a preview of matches */
  products: CollectionProductRow[];
  productCount: number;
  publishedCount: number;
};

/* ─── Helpers ───────────────────────────────────────────────────────────── */

const fail = (error: string): ActionResult<never> => ({ success: false, error });

const PRODUCT_SELECT = {
  id: true,
  name: true,
  sku: true,
  isPublished: true,
  status: true,
  sellingPrice: true,
  images: { select: { url: true }, orderBy: { sortOrder: 'asc' }, take: 1 },
} satisfies Prisma.InventoryItemSelect;

type ProductPayload = Prisma.InventoryItemGetPayload<{ select: typeof PRODUCT_SELECT }>;

function toProductRow(item: ProductPayload): CollectionProductRow {
  return {
    id: item.id,
    name: item.name,
    sku: item.sku,
    imageUrl: item.images[0]?.url ?? null,
    price: item.sellingPrice === null ? null : Number(item.sellingPrice),
    isPublished: item.isPublished,
    status: item.status,
  };
}

/** Units sold per product (variants rolled up to their parent), for BESTSELLING. */
async function soldCounts(organizationId: string): Promise<Map<string, number>> {
  const lines = await prisma.invoiceLineItem.findMany({
    where: {
      inventoryItemId: { not: null },
      invoice: { organizationId, status: { in: ['SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'] } },
    },
    select: { inventoryItemId: true, quantity: true, inventoryItem: { select: { parentItemId: true } } },
  });
  const counts = new Map<string, number>();
  for (const line of lines) {
    const key = line.inventoryItem?.parentItemId ?? line.inventoryItemId!;
    counts.set(key, (counts.get(key) ?? 0) + Number(line.quantity));
  }
  return counts;
}

async function ruleWhere(organizationId: string, rule: CollectionRule): Promise<Prisma.InventoryItemWhereInput> {
  let categoryIds: string[] | undefined;
  if (rule.matchCategoryId) {
    const categories = await prisma.category.findMany({
      where: { organizationId },
      select: { id: true, name: true, slug: true, parentId: true, sortOrder: true },
    });
    categoryIds = [rule.matchCategoryId, ...descendantIds(categories, rule.matchCategoryId)];
  }
  return {
    organizationId,
    parentItemId: null,
    status: ItemStatus.ACTIVE,
    ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
    ...(rule.matchTag ? { tags: { has: rule.matchTag } } : {}),
    ...(rule.matchMinPrice !== null || rule.matchMaxPrice !== null
      ? {
          sellingPrice: {
            ...(rule.matchMinPrice !== null ? { gte: rule.matchMinPrice } : {}),
            ...(rule.matchMaxPrice !== null ? { lte: rule.matchMaxPrice } : {}),
          },
        }
      : {}),
    ...(rule.matchCreatedWithinDays !== null
      ? { createdAt: { gte: new Date(Date.now() - rule.matchCreatedWithinDays * 86_400_000) } }
      : {}),
  };
}

function orderFor(sort: CollectionSort): Prisma.InventoryItemOrderByWithRelationInput[] {
  switch (sort) {
    case 'NEWEST':
      return [{ createdAt: 'desc' }];
    case 'PRICE_ASC':
      return [{ sellingPrice: 'asc' }, { name: 'asc' }];
    case 'PRICE_DESC':
      return [{ sellingPrice: 'desc' }, { name: 'asc' }];
    default:
      return [{ name: 'asc' }];
  }
}

/** Resolves a dynamic rule to products, in the collection's own order. */
async function resolveDynamic(
  organizationId: string,
  rule: CollectionRule,
  sort: CollectionSort,
  limit: number,
): Promise<{ total: number; publishedCount: number; products: CollectionProductRow[] }> {
  const where = await ruleWhere(organizationId, rule);
  const [total, publishedCount, items] = await Promise.all([
    prisma.inventoryItem.count({ where }),
    prisma.inventoryItem.count({ where: { ...where, isPublished: true } }),
    prisma.inventoryItem.findMany({
      where,
      select: PRODUCT_SELECT,
      orderBy: orderFor(sort),
      // Best-selling can't be ordered in SQL (sales live on invoice lines), so
      // that case pulls a wider slice and ranks it here.
      take: sort === 'BESTSELLING' ? Math.max(limit * 5, 100) : limit,
    }),
  ]);

  let rows = items.map(toProductRow);
  if (sort === 'BESTSELLING') {
    const sold = await soldCounts(organizationId);
    rows.sort((a, b) => (sold.get(b.id) ?? 0) - (sold.get(a.id) ?? 0) || a.name.localeCompare(b.name));
    rows = rows.slice(0, limit);
  }
  return { total, publishedCount, products: rows };
}

async function curatedProducts(collectionId: string): Promise<CollectionProductRow[]> {
  const members = await prisma.collectionItem.findMany({
    where: { collectionId },
    orderBy: { position: 'asc' },
    select: { inventoryItem: { select: PRODUCT_SELECT } },
  });
  return members.map((m) => toProductRow(m.inventoryItem));
}

/** Managing merchandising (categories, brands, collections) shares one permission. */
function requireManage(permissions: string[]): void {
  requirePermission(permissions, PERMISSIONS.INVENTORY_CATEGORY_MANAGE);
}

/* ─── Validation ────────────────────────────────────────────────────────── */

const image = z
  .object({ url: z.string().url(), publicId: z.string().min(1) })
  .nullish();

const CollectionSchema = z.object({
  name: z.string().trim().min(1, 'Give the collection a name').max(80, 'Name must be 80 characters or less'),
  slug: z.string().trim().max(80).default(''),
  tagline: z.string().trim().max(160, 'Keep the tagline under 160 characters').nullish(),
  description: z.string().trim().max(2000, 'Description must be 2,000 characters or less').nullish(),
  image,
  heroImage: image,
  isVisible: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  kind: z.enum(CollectionKind).default(CollectionKind.CURATED),
  sort: z.enum(CollectionSort).default(CollectionSort.RELEVANCE),
  matchCategoryId: z.string().cuid().nullish(),
  matchTag: z.string().nullish(),
  matchMinPrice: z.number().nonnegative().nullish(),
  matchMaxPrice: z.number().nonnegative().nullish(),
  matchCreatedWithinDays: z.number().int().positive().nullish(),
  /** CURATED only, in editorial order */
  productIds: z.array(z.string().cuid()).max(500, 'A collection can hold at most 500 products').default([]),
});

export type CollectionInput = z.input<typeof CollectionSchema>;
type ParsedCollection = z.output<typeof CollectionSchema>;

/** Prisma row (Decimal prices) → the plain rule shape. */
function toRule(row: {
  matchCategoryId: string | null;
  matchTag: string | null;
  matchMinPrice: Prisma.Decimal | null;
  matchMaxPrice: Prisma.Decimal | null;
  matchCreatedWithinDays: number | null;
}): CollectionRule {
  return {
    matchCategoryId: row.matchCategoryId,
    matchTag: row.matchTag,
    matchMinPrice: row.matchMinPrice === null ? null : Number(row.matchMinPrice),
    matchMaxPrice: row.matchMaxPrice === null ? null : Number(row.matchMaxPrice),
    matchCreatedWithinDays: row.matchCreatedWithinDays,
  };
}

function ruleOf(data: ParsedCollection): CollectionRule {
  return {
    matchCategoryId: data.matchCategoryId ?? null,
    matchTag: data.matchTag ?? null,
    matchMinPrice: data.matchMinPrice ?? null,
    matchMaxPrice: data.matchMaxPrice ?? null,
    matchCreatedWithinDays: data.matchCreatedWithinDays ?? null,
  };
}

async function validate(
  organizationId: string,
  data: ParsedCollection,
  existingId: string | null,
): Promise<{ error: string } | { slug: string }> {
  if (data.kind === CollectionKind.DYNAMIC) {
    const problem = ruleProblem(ruleOf(data));
    if (problem) return { error: problem };
    if (data.matchTag && !isProductTag(data.matchTag)) return { error: 'That tag isn’t recognised.' };
    if (data.matchCategoryId) {
      const category = await prisma.category.findFirst({ where: { id: data.matchCategoryId, organizationId }, select: { id: true } });
      if (!category) return { error: 'That category no longer exists.' };
    }
  } else if (data.productIds.length > 0) {
    const owned = await prisma.inventoryItem.count({
      where: { id: { in: data.productIds }, organizationId, parentItemId: null },
    });
    if (owned !== new Set(data.productIds).size) return { error: 'One of the products no longer exists. Reload and try again.' };
  }

  for (const img of [data.image, data.heroImage]) {
    if (img && !isOrgAsset(img, organizationId)) {
      return { error: 'One of the images wasn’t uploaded through this workspace. Remove it and upload it again.' };
    }
  }

  const all = await prisma.collection.findMany({ where: { organizationId }, select: { id: true, name: true, slug: true } });
  const others = all.filter((c) => c.id !== existingId);
  if (others.some((c) => c.name.toLowerCase() === data.name.toLowerCase())) {
    return { error: `You already have a collection called “${data.name}”.` };
  }

  let slug = data.slug;
  if (slug) {
    if (!SLUG_PATTERN.test(slug)) return { error: 'The web address can only use lowercase letters, numbers and single hyphens.' };
    if (others.some((c) => c.slug === slug)) return { error: `The web address “${slug}” is already used by another collection.` };
  } else {
    // Keep the existing address on rename; only a new collection gets one generated.
    const current = existingId ? all.find((c) => c.id === existingId)?.slug : undefined;
    slug = current ?? uniqueSlug(slugify(data.name), others.map((c) => c.slug));
  }
  return { slug };
}

function fieldsOf(data: ParsedCollection, slug: string) {
  const dynamic = data.kind === CollectionKind.DYNAMIC;
  return {
    name: data.name,
    slug,
    tagline: data.tagline || null,
    description: data.description || null,
    imageUrl: data.image?.url ?? null,
    imagePublicId: data.image?.publicId ?? null,
    heroImageUrl: data.heroImage?.url ?? null,
    heroPublicId: data.heroImage?.publicId ?? null,
    isVisible: data.isVisible,
    isFeatured: data.isFeatured,
    kind: data.kind,
    sort: data.sort,
    // Rule fields only mean anything for a dynamic collection; clear them otherwise
    // so a kind switch can't leave a stale condition behind.
    matchCategoryId: dynamic ? (data.matchCategoryId ?? null) : null,
    matchTag: dynamic ? (data.matchTag ?? null) : null,
    matchMinPrice: dynamic ? (data.matchMinPrice ?? null) : null,
    matchMaxPrice: dynamic ? (data.matchMaxPrice ?? null) : null,
    matchCreatedWithinDays: dynamic ? (data.matchCreatedWithinDays ?? null) : null,
  };
}

/* ─── Reads ─────────────────────────────────────────────────────────────── */

export async function listCollections(): Promise<ActionResult<CollectionListRow[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_VIEW);
    const organizationId = ctx.organization.id;

    const collections = await prisma.collection.findMany({
      where: { organizationId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { items: true } } },
    });

    const rows = await Promise.all(
      collections.map(async (c): Promise<CollectionListRow> => {
        let productCount = c._count.items;
        let publishedCount = 0;
        if (c.kind === CollectionKind.DYNAMIC) {
          const where = await ruleWhere(organizationId, toRule(c));
          [productCount, publishedCount] = await Promise.all([
            prisma.inventoryItem.count({ where }),
            prisma.inventoryItem.count({ where: { ...where, isPublished: true } }),
          ]);
        } else if (productCount > 0) {
          publishedCount = await prisma.inventoryItem.count({
            where: { collections: { some: { collectionId: c.id } }, isPublished: true, status: ItemStatus.ACTIVE },
          });
        }
        return {
          id: c.id,
          name: c.name,
          slug: c.slug,
          tagline: c.tagline,
          kind: c.kind,
          isVisible: c.isVisible,
          isFeatured: c.isFeatured,
          sortOrder: c.sortOrder,
          imageUrl: c.imageUrl,
          productCount,
          publishedCount,
        };
      }),
    );

    return { success: true, data: rows };
  } catch (err) {
    return toActionError(err, 'Failed to load collections');
  }
}

export async function getCollection(collectionId: string): Promise<ActionResult<CollectionDetail>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_VIEW);

    const c = await prisma.collection.findFirst({ where: { id: collectionId, organizationId: ctx.organization.id } });
    if (!c) return fail('Collection not found');

    const rule = toRule(c);

    let products: CollectionProductRow[];
    let productCount: number;
    let publishedCount: number;
    if (c.kind === CollectionKind.DYNAMIC) {
      const resolved = await resolveDynamic(ctx.organization.id, rule, c.sort, 48);
      products = resolved.products;
      productCount = resolved.total;
      publishedCount = resolved.publishedCount;
    } else {
      products = await curatedProducts(c.id);
      productCount = products.length;
      publishedCount = products.filter((p) => p.isPublished && p.status === ItemStatus.ACTIVE).length;
    }

    return {
      success: true,
      data: {
        id: c.id,
        name: c.name,
        slug: c.slug,
        tagline: c.tagline,
        description: c.description,
        imageUrl: c.imageUrl,
        imagePublicId: c.imagePublicId,
        heroImageUrl: c.heroImageUrl,
        heroPublicId: c.heroPublicId,
        isVisible: c.isVisible,
        isFeatured: c.isFeatured,
        kind: c.kind,
        sort: c.sort,
        ...rule,
        products,
        productCount,
        publishedCount,
      },
    };
  } catch (err) {
    return toActionError(err, 'Failed to load collection');
  }
}

/** Live preview while editing a dynamic rule. */
export async function previewCollection(
  rule: CollectionRule,
  sort: CollectionSort = CollectionSort.RELEVANCE,
): Promise<ActionResult<{ total: number; publishedCount: number; products: CollectionProductRow[] }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_VIEW);
    const problem = ruleProblem(rule);
    if (problem) return fail(problem);
    return { success: true, data: await resolveDynamic(ctx.organization.id, rule, sort, 12) };
  } catch (err) {
    return toActionError(err, 'Failed to preview this collection');
  }
}

/** Product search for the hand-picked product picker. */
export async function searchCollectionProducts(query: string, excludeIds: string[] = []): Promise<ActionResult<CollectionProductRow[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_VIEW);
    const q = query.trim();

    const items = await prisma.inventoryItem.findMany({
      where: {
        organizationId: ctx.organization.id,
        parentItemId: null,
        status: { not: ItemStatus.ARCHIVED },
        id: { notIn: excludeIds.slice(0, 500) },
        ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { sku: { contains: q, mode: 'insensitive' } }] } : {}),
      },
      select: PRODUCT_SELECT,
      orderBy: { name: 'asc' },
      take: 20,
    });
    return { success: true, data: items.map(toProductRow) };
  } catch (err) {
    return toActionError(err, 'Failed to search products');
  }
}

/* ─── Writes ────────────────────────────────────────────────────────────── */

export async function createCollection(input: CollectionInput): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await getOrganizationContext();
    requireManage(ctx.membership.role.permissions);
    const organizationId = ctx.organization.id;

    const parsed = CollectionSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Please check the form');
    const data = parsed.data;

    const checked = await validate(organizationId, data, null);
    if ('error' in checked) return fail(checked.error);

    const last = await prisma.collection.aggregate({ where: { organizationId }, _max: { sortOrder: true } });

    const collection = await prisma.collection.create({
      data: {
        organizationId,
        ...fieldsOf(data, checked.slug),
        sortOrder: (last._max.sortOrder ?? -1) + 1,
        ...(data.kind === CollectionKind.CURATED && data.productIds.length
          ? { items: { create: data.productIds.map((id, position) => ({ inventoryItemId: id, position })) } }
          : {}),
      },
    });

    await createAuditLog({
      organizationId,
      userId: ctx.userId,
      action: 'inventory.collection.created',
      entityType: 'Collection',
      entityId: collection.id,
      metadata: { name: data.name, kind: data.kind },
    });

    return { success: true, data: { id: collection.id } };
  } catch (err) {
    return toActionError(err, 'Failed to create collection');
  }
}

export async function updateCollection(collectionId: string, input: CollectionInput): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requireManage(ctx.membership.role.permissions);
    const organizationId = ctx.organization.id;

    const parsed = CollectionSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Please check the form');
    const data = parsed.data;

    const existing = await prisma.collection.findFirst({ where: { id: collectionId, organizationId } });
    if (!existing) return fail('Collection not found');

    const checked = await validate(organizationId, data, collectionId);
    if ('error' in checked) return fail(checked.error);

    await prisma.$transaction(async (tx) => {
      await tx.collection.update({ where: { id: collectionId }, data: fieldsOf(data, checked.slug) });
      if (data.kind === CollectionKind.CURATED) {
        await tx.collectionItem.deleteMany({ where: { collectionId } });
        if (data.productIds.length) {
          await tx.collectionItem.createMany({
            data: data.productIds.map((id, position) => ({ collectionId, inventoryItemId: id, position })),
          });
        }
      } else {
        // Members are meaningless for a rule-based collection; drop them so
        // switching back later doesn't resurrect a stale hand-picked list.
        await tx.collectionItem.deleteMany({ where: { collectionId } });
      }
    });

    // Replaced images are deleted after the record is safely saved.
    for (const [oldId, newId] of [
      [existing.imagePublicId, data.image?.publicId ?? null],
      [existing.heroPublicId, data.heroImage?.publicId ?? null],
    ]) {
      if (oldId && oldId !== newId) void destroyAsset(oldId);
    }

    await createAuditLog({
      organizationId,
      userId: ctx.userId,
      action: 'inventory.collection.updated',
      entityType: 'Collection',
      entityId: collectionId,
      metadata: { name: data.name, kind: data.kind },
    });

    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to save collection');
  }
}

export async function deleteCollection(collectionId: string): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requireManage(ctx.membership.role.permissions);

    const existing = await prisma.collection.findFirst({
      where: { id: collectionId, organizationId: ctx.organization.id },
      select: { id: true, name: true, imagePublicId: true, heroPublicId: true },
    });
    if (!existing) return fail('Collection not found');

    await prisma.collection.delete({ where: { id: collectionId } });
    for (const publicId of [existing.imagePublicId, existing.heroPublicId]) {
      if (publicId) void destroyAsset(publicId);
    }

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'inventory.collection.deleted',
      entityType: 'Collection',
      entityId: collectionId,
      metadata: { name: existing.name },
    });

    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to delete collection');
  }
}

/** Quick show/hide from the list, without rebuilding the whole record. */
export async function updateCollectionVisibility(collectionId: string, isVisible: boolean): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requireManage(ctx.membership.role.permissions);

    const existing = await prisma.collection.findFirst({
      where: { id: collectionId, organizationId: ctx.organization.id },
      select: { id: true, name: true },
    });
    if (!existing) return fail('Collection not found');

    await prisma.collection.update({ where: { id: collectionId }, data: { isVisible } });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'inventory.collection.updated',
      entityType: 'Collection',
      entityId: collectionId,
      metadata: { name: existing.name, isVisible },
    });

    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to update collection');
  }
}

/** Swap a collection with its neighbour — the order customers see. */
export async function moveCollection(collectionId: string, direction: 'up' | 'down'): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requireManage(ctx.membership.role.permissions);

    const all = await prisma.collection.findMany({
      where: { organizationId: ctx.organization.id },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true },
    });
    const index = all.findIndex((c) => c.id === collectionId);
    if (index === -1) return fail('Collection not found');
    const swapWith = direction === 'up' ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= all.length) return { success: true, data: undefined };

    [all[index], all[swapWith]] = [all[swapWith], all[index]];
    await prisma.$transaction(all.map((c, i) => prisma.collection.update({ where: { id: c.id }, data: { sortOrder: i } })));

    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to reorder collections');
  }
}

/** Whether this member can manage merchandising records. */
export async function canManageMerchandising(): Promise<boolean> {
  const ctx = await getOrganizationContext();
  return hasPermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_CATEGORY_MANAGE);
}
