'use server';

// Products = top-level catalog items (STANDARD with or without variants, and
// KITs), edited as one record with their online-store fields, images and
// variants. One catalogue: this is also what the storefront sells.
// Rules live in ./product-rules.ts; this file enforces them and persists.

import { after } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { destroyAsset, isOrgAsset } from '@/lib/cloudinary/sign';
import { ItemStatus, ItemType } from '@/lib/generated/prisma/enums';
import { Prisma } from '@/lib/generated/prisma/client';
import { type ActionResult, toActionError } from './shared';
import {
  indexPendingImages,
  productImageSearchStatus,
  requeueProductImages,
  syncProductImageEmbeddings,
  type ProductImageSearchStatus,
} from '@/lib/storefront/visual-search/indexing';
import { SLUG_PATTERN, buildCategoryTree, descendantIds, flattenCategoryTree, slugify, uniqueSlug } from './category-tree';
import {
  MAX_VARIANTS,
  combinationKey,
  compareAtProblem,
  isProductTag,
  normalizeVariantOptions,
  optionsProblem,
  productReadiness,
  publishBlockers,
  variantLabel,
  type VariantOption,
} from './product-rules';

/* ─── Types ─────────────────────────────────────────────────────────────── */

export type StockState = 'in' | 'low' | 'out';

export type ProductListRow = {
  id: string;
  name: string;
  sku: string;
  itemType: ItemType;
  status: ItemStatus;
  isPublished: boolean;
  imageUrl: string | null;
  categoryPath: string[];
  brandName: string | null;
  variantCount: number;
  priceMin: number | null;
  priceMax: number | null;
  /** on hand minus reserved, across every store */
  available: number;
  /** available in stores that sell online */
  onlineAvailable: number;
  unit: string;
  stockState: StockState;
  updatedAt: string;
};

export type ProductListParams = {
  q?: string;
  categoryId?: string;
  brandId?: string;
  /** default: everything except archived */
  status?: ItemStatus | 'all';
  online?: 'published' | 'draft';
  stock?: StockState;
  sort?: 'name' | 'newest' | 'stock-asc' | 'stock-desc';
  page?: number;
  perPage?: number;
};

export type ProductListResult = {
  rows: ProductListRow[];
  total: number;
  page: number;
  perPage: number;
  pageCount: number;
  /** products in the org at all (ignoring filters) — tells "no results" from "no products" */
  catalogSize: number;
};

export type ProductImageInput = { url: string; publicId: string; alt?: string; width?: number | null; height?: number | null };

export type ProductDetail = {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  unit: string;
  description: string | null;
  shortDescription: string | null;
  itemType: ItemType;
  status: ItemStatus;
  categoryId: string | null;
  brandId: string | null;
  preferredSupplierId: string | null;
  reorderPoint: number | null;
  sellingPrice: number | null;
  compareAtPrice: number | null;
  averageCost: number;
  slug: string | null;
  isPublished: boolean;
  publishedAt: string | null;
  /** true = the customer must pay before delivery; pay on delivery isn't offered */
  requiresPrepayment: boolean;
  tags: string[];
  highlights: string[];
  specs: { label: string; value: string }[];
  images: (ProductImageInput & { id: string })[];
  options: VariantOption[];
  variants: {
    id: string;
    sku: string;
    barcode: string | null;
    attributes: Record<string, string>;
    sellingPrice: number | null;
    compareAtPrice: number | null;
    imageUrl: string | null;
    status: ItemStatus;
    available: number;
    onlineAvailable: number;
  }[];
  stockByStore: {
    warehouseId: string;
    warehouseName: string;
    sellsOnline: boolean;
    onHand: number;
    reserved: number;
    available: number;
  }[];
  kitComponents: { id: string; name: string; sku: string; quantity: number }[];
  hasStockHistory: boolean;
  createdAt: string;
  updatedAt: string;
};

/* ─── Validation ────────────────────────────────────────────────────────── */

const money = z.number().nonnegative('Prices can’t be negative').max(9_999_999_999, 'That price is too large').nullish();

const ProductSchema = z.object({
  name: z.string().trim().min(1, 'Give the product a name').max(150, 'Name must be 150 characters or less'),
  sku: z.string().trim().min(1, 'Add a SKU').max(60, 'SKU must be 60 characters or less'),
  barcode: z.string().trim().max(60).nullish(),
  unit: z.string().trim().min(1).max(20).default('pcs'),
  description: z.string().trim().max(5000, 'Description must be 5,000 characters or less').nullish(),
  shortDescription: z.string().trim().max(200, 'Short description must be 200 characters or less').nullish(),
  categoryId: z.string().cuid().nullish(),
  brandId: z.string().cuid().nullish(),
  preferredSupplierId: z.string().cuid().nullish(),
  reorderPoint: z.number().nonnegative('Reorder point can’t be negative').nullish(),
  sellingPrice: money,
  compareAtPrice: money,
  status: z.enum(ItemStatus).default(ItemStatus.ACTIVE),
  isPublished: z.boolean().default(false),
  requiresPrepayment: z.boolean().default(false),
  slug: z.string().trim().max(80).default(''),
  tags: z.array(z.string()).max(10).default([]),
  highlights: z.array(z.string().trim().min(1).max(120, 'Each highlight must be 120 characters or less')).max(8, 'Use at most 8 highlights').default([]),
  specs: z
    .array(z.object({ label: z.string().trim().min(1).max(60), value: z.string().trim().min(1).max(200) }))
    .max(30, 'Use at most 30 specifications')
    .default([]),
  images: z
    .array(
      z.object({
        url: z.string().url(),
        publicId: z.string().min(1),
        alt: z.string().trim().max(200).optional(),
        width: z.number().int().positive().nullish(),
        height: z.number().int().positive().nullish(),
      }),
    )
    .max(12, 'Use at most 12 images')
    .default([]),
  options: z
    .array(
      z.object({
        name: z.string().trim(),
        kind: z.enum(['color', 'size', 'select']),
        values: z.array(z.object({ label: z.string().trim(), swatch: z.string().optional() })),
      }),
    )
    .default([]),
  variants: z
    .array(
      z.object({
        id: z.string().cuid().optional(),
        sku: z.string().trim().min(1, 'Every variant needs a SKU').max(60),
        barcode: z.string().trim().max(60).nullish(),
        attributes: z.record(z.string(), z.string()),
        sellingPrice: money,
        compareAtPrice: money,
        /** refers to one of `images` by URL (images have no id before saving) */
        imageUrl: z.string().nullish(),
      }),
    )
    .max(MAX_VARIANTS, `A product can have at most ${MAX_VARIANTS} variants`)
    .default([]),
});

export type ProductInput = z.input<typeof ProductSchema>;
type ParsedProduct = z.output<typeof ProductSchema>;

const fail = (error: string): ActionResult<never> => ({ success: false, error });

const num = (d: Prisma.Decimal | null | undefined): number | null => (d === null || d === undefined ? null : Number(d));

/** Checks that need the org's data; returns a user-facing error or null. */
async function validateProduct(
  organizationId: string,
  data: ParsedProduct,
  existing: { id: string; itemType: ItemType; variantIds: string[] } | null,
): Promise<{ error: string } | { slug: string; categoryVisible: boolean; onlineStoreCount: number }> {
  // Ownership of every referenced record.
  const [category, brand, supplier, categories, onlineStoreCount] = await Promise.all([
    data.categoryId ? prisma.category.findFirst({ where: { id: data.categoryId, organizationId }, select: { id: true } }) : null,
    data.brandId ? prisma.brand.findFirst({ where: { id: data.brandId, organizationId }, select: { id: true } }) : null,
    data.preferredSupplierId
      ? prisma.supplier.findFirst({ where: { id: data.preferredSupplierId, organizationId }, select: { id: true } })
      : null,
    prisma.category.findMany({
      where: { organizationId },
      select: { id: true, name: true, slug: true, parentId: true, sortOrder: true, isVisible: true },
    }),
    prisma.warehouse.count({ where: { organizationId, sellsOnline: true, status: 'ACTIVE' } }),
  ]);
  if (data.categoryId && !category) return { error: 'That category no longer exists.' };
  if (data.brandId && !brand) return { error: 'That brand no longer exists.' };
  if (data.preferredSupplierId && !supplier) return { error: 'That supplier no longer exists.' };

  const invalidTag = data.tags.find((t) => !isProductTag(t));
  if (invalidTag) return { error: `“${invalidTag}” isn’t a recognised tag.` };

  for (const image of data.images) {
    if (!isOrgAsset(image, organizationId)) return { error: 'One of the images wasn’t uploaded through this workspace. Remove it and upload it again.' };
  }

  const priceProblem = compareAtProblem(data.sellingPrice ?? null, data.compareAtPrice ?? null);
  if (priceProblem && data.variants.length === 0) return { error: priceProblem };

  // Variants
  if (existing?.itemType === ItemType.KIT && (data.options.length || data.variants.length)) {
    return { error: 'Kits can’t have variants.' };
  }
  if (data.options.length || data.variants.length) {
    const options = data.options as VariantOption[];
    const problem = optionsProblem(options);
    if (problem) return { error: problem };
    if (data.variants.length === 0) return { error: 'Add at least one variant, or remove the options.' };

    const valid = new Map(options.map((o) => [o.name, new Set(o.values.map((v) => v.label))]));
    const seenCombos = new Set<string>();
    const seenSkus = new Set<string>([data.sku.toLowerCase()]);
    const imageUrls = new Set(data.images.map((i) => i.url));
    for (const variant of data.variants) {
      for (const option of options) {
        if (!valid.get(option.name)?.has(variant.attributes[option.name] ?? '')) {
          return { error: `A variant is missing a valid “${option.name}”.` };
        }
      }
      const key = combinationKey(variant.attributes, options);
      if (seenCombos.has(key)) return { error: `The variant ${variantLabel(variant.attributes, options)} is listed twice.` };
      seenCombos.add(key);
      if (seenSkus.has(variant.sku.toLowerCase())) return { error: `The SKU “${variant.sku}” is used more than once.` };
      seenSkus.add(variant.sku.toLowerCase());
      if (variant.id && !existing?.variantIds.includes(variant.id)) return { error: 'One of the variants no longer exists. Reload and try again.' };
      if (variant.imageUrl && !imageUrls.has(variant.imageUrl)) return { error: 'A variant uses an image that isn’t on this product.' };
      const effective = variant.sellingPrice ?? data.sellingPrice ?? null;
      const vProblem = compareAtProblem(effective, variant.compareAtPrice ?? null);
      if (vProblem) return { error: `${variantLabel(variant.attributes, options)}: ${vProblem}` };
    }
  }

  // SKUs must be unique across the org (excluding this product's own rows).
  const ownIds = existing ? [existing.id, ...existing.variantIds] : [];
  const skus = [data.sku, ...data.variants.map((v) => v.sku)];
  const clash = await prisma.inventoryItem.findFirst({
    where: { organizationId, sku: { in: skus, mode: 'insensitive' }, id: { notIn: ownIds } },
    select: { sku: true },
  });
  if (clash) return { error: `The SKU “${clash.sku}” is already used by another product.` };

  // Web address
  let slug = data.slug;
  const taken = await prisma.inventoryItem.findMany({
    where: { organizationId, slug: { not: null }, id: { notIn: ownIds } },
    select: { slug: true },
  });
  const takenSlugs = taken.map((t) => t.slug!);
  if (slug) {
    if (!SLUG_PATTERN.test(slug)) return { error: 'The web address can only use lowercase letters, numbers and single hyphens.' };
    if (takenSlugs.includes(slug)) return { error: `The web address “${slug}” is already used by another product.` };
  } else {
    slug = uniqueSlug(slugify(data.name), takenSlugs);
  }

  // Publishing requires the blockers to be clear.
  const categoryVisible = data.categoryId ? ancestorsVisible(categories, data.categoryId) : false;

  if (data.isPublished) {
    const prices = data.variants.length ? data.variants.map((v) => v.sellingPrice ?? data.sellingPrice ?? null) : [data.sellingPrice ?? null];
    const blockers = publishBlockers(
      productReadiness({
        imageCount: data.images.length,
        prices,
        hasCategory: Boolean(data.categoryId),
        categoryVisible,
        hasDescription: Boolean(data.description),
        onlineStoreCount,
        onlineAvailable: null,
      }),
    );
    if (blockers.length) {
      return { error: `To publish, first fix: ${blockers.map((b) => b.label.toLowerCase()).join(' and ')}. Or save it as a draft.` };
    }
    if (data.status !== ItemStatus.ACTIVE) return { error: 'Only active products can be published. Set the status to Active, or unpublish it.' };
  }

  return { slug, categoryVisible, onlineStoreCount };
}

function ancestorsVisible(rows: { id: string; parentId: string | null; isVisible: boolean }[], id: string): boolean {
  const byId = new Map(rows.map((r) => [r.id, r]));
  let current = byId.get(id);
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    if (!current.isVisible) return false;
    seen.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return true;
}

function p2002(err: unknown): boolean {
  return err instanceof Error && 'code' in err && (err as { code?: string }).code === 'P2002';
}

/* ─── Stock helpers ─────────────────────────────────────────────────────── */

type LevelLike = { quantity: Prisma.Decimal; reservedQty: Prisma.Decimal; warehouse: { sellsOnline: boolean; status: string } };

function sumLevels(levels: LevelLike[]) {
  let available = 0;
  let onlineAvailable = 0;
  for (const l of levels) {
    const a = Number(l.quantity) - Number(l.reservedQty);
    available += a;
    if (l.warehouse.sellsOnline && l.warehouse.status === 'ACTIVE') onlineAvailable += Math.max(0, a);
  }
  return { available, onlineAvailable };
}

/* ─── List ──────────────────────────────────────────────────────────────── */

export async function listProducts(params: ProductListParams = {}): Promise<ActionResult<ProductListResult>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_VIEW);
    const organizationId = ctx.organization.id;

    const perPage = Math.min(Math.max(params.perPage ?? 25, 5), 100);
    const q = params.q?.trim();

    let categoryIds: string[] | undefined;
    if (params.categoryId) {
      const rows = await prisma.category.findMany({
        where: { organizationId },
        select: { id: true, name: true, slug: true, parentId: true, sortOrder: true },
      });
      categoryIds = [params.categoryId, ...descendantIds(rows, params.categoryId)];
    }

    const where: Prisma.InventoryItemWhereInput = {
      organizationId,
      parentItemId: null,
      ...(params.status === 'all' ? {} : params.status ? { status: params.status } : { status: { not: ItemStatus.ARCHIVED } }),
      ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
      ...(params.brandId ? { brandId: params.brandId } : {}),
      ...(params.online ? { isPublished: params.online === 'published' } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { sku: { contains: q, mode: 'insensitive' } },
              { barcode: { contains: q, mode: 'insensitive' } },
              { variants: { some: { OR: [{ sku: { contains: q, mode: 'insensitive' } }, { barcode: { contains: q, mode: 'insensitive' } }] } } },
            ],
          }
        : {}),
    };

    const levelSelect = { select: { quantity: true, reservedQty: true, warehouse: { select: { sellsOnline: true, status: true } } } };

    const [items, catalogSize, categories] = await Promise.all([
      prisma.inventoryItem.findMany({
        where,
        select: {
          id: true,
          name: true,
          sku: true,
          unit: true,
          itemType: true,
          status: true,
          isPublished: true,
          sellingPrice: true,
          reorderPoint: true,
          categoryId: true,
          updatedAt: true,
          createdAt: true,
          brand: { select: { name: true } },
          images: { select: { url: true }, orderBy: { sortOrder: 'asc' }, take: 1 },
          inventoryLevels: levelSelect,
          variants: {
            where: { status: { not: ItemStatus.ARCHIVED } },
            select: { sellingPrice: true, reorderPoint: true, inventoryLevels: levelSelect },
          },
        },
      }),
      prisma.inventoryItem.count({ where: { organizationId, parentItemId: null } }),
      prisma.category.findMany({
        where: { organizationId },
        select: { id: true, name: true, slug: true, parentId: true, sortOrder: true },
      }),
    ]);

    const paths = new Map(flattenCategoryTree(buildCategoryTree(categories)).map((c) => [c.id, c.namePath]));

    let rows: (ProductListRow & { createdAt: Date })[] = items.map((item) => {
      const units = item.variants.length
        ? item.variants.map((v) => ({ price: num(v.sellingPrice) ?? num(item.sellingPrice), reorderPoint: num(v.reorderPoint), ...sumLevels(v.inventoryLevels) }))
        : [{ price: num(item.sellingPrice), reorderPoint: num(item.reorderPoint), ...sumLevels(item.inventoryLevels) }];
      const prices = units.map((u) => u.price).filter((p): p is number => p !== null);
      const available = units.reduce((s, u) => s + u.available, 0);
      const stockState: StockState =
        available <= 0 ? 'out' : units.some((u) => u.reorderPoint !== null && u.available <= u.reorderPoint) ? 'low' : 'in';
      return {
        id: item.id,
        name: item.name,
        sku: item.sku,
        unit: item.unit,
        itemType: item.itemType,
        status: item.status,
        isPublished: item.isPublished,
        imageUrl: item.images[0]?.url ?? null,
        categoryPath: item.categoryId ? (paths.get(item.categoryId) ?? []) : [],
        brandName: item.brand?.name ?? null,
        variantCount: item.variants.length,
        priceMin: prices.length ? Math.min(...prices) : null,
        priceMax: prices.length ? Math.max(...prices) : null,
        available,
        onlineAvailable: units.reduce((s, u) => s + u.onlineAvailable, 0),
        stockState,
        updatedAt: item.updatedAt.toISOString(),
        createdAt: item.createdAt,
      };
    });

    // Stock is derived per product, so it's filtered and sorted after the query.
    if (params.stock) rows = rows.filter((r) => r.stockState === params.stock);
    const sort = params.sort ?? 'name';
    rows.sort((a, b) => {
      if (sort === 'newest') return b.createdAt.getTime() - a.createdAt.getTime();
      if (sort === 'stock-asc') return a.available - b.available || a.name.localeCompare(b.name);
      if (sort === 'stock-desc') return b.available - a.available || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    });

    const total = rows.length;
    const pageCount = Math.max(1, Math.ceil(total / perPage));
    const page = Math.min(Math.max(params.page ?? 1, 1), pageCount);
    const pageRows = rows.slice((page - 1) * perPage, page * perPage).map(({ createdAt: _createdAt, ...r }) => r);

    return { success: true, data: { rows: pageRows, total, page, perPage, pageCount, catalogSize } };
  } catch (err) {
    return toActionError(err, 'Failed to load products');
  }
}

/* ─── Detail ────────────────────────────────────────────────────────────── */

const HISTORY_COUNT = {
  stockMovements: true,
  poLineItems: true,
  quoteLineItems: true,
  invoiceLineItems: true,
  fulfillmentLineItems: true,
  cycleCountItems: true,
  stockTransfers: true,
  requisitionItems: true,
  kitComponentOf: true,
} as const;

function hasHistory(count: Record<keyof typeof HISTORY_COUNT, number>): boolean {
  return Object.values(count).some((n) => n > 0);
}

export async function getProduct(productId: string): Promise<ActionResult<ProductDetail>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_VIEW);

    const levelInclude = { include: { warehouse: { select: { id: true, name: true, sellsOnline: true, status: true } } } };
    const item = await prisma.inventoryItem.findFirst({
      where: { id: productId, organizationId: ctx.organization.id, parentItemId: null },
      include: {
        images: { orderBy: { sortOrder: 'asc' } },
        inventoryLevels: levelInclude,
        _count: { select: HISTORY_COUNT },
        kitComponents: { include: { componentItem: { select: { id: true, name: true, sku: true } } } },
        variants: {
          orderBy: { createdAt: 'asc' },
          include: { inventoryLevels: levelInclude, image: { select: { url: true } }, _count: { select: HISTORY_COUNT } },
        },
      },
    });
    if (!item) return fail('Product not found');

    const attributesOf = (v: { variantAttributes: Prisma.JsonValue }) => (v.variantAttributes as Record<string, string> | null) ?? {};
    const options = normalizeVariantOptions(item.variantOptions, item.variants.map(attributesOf));

    const stores = new Map<string, ProductDetail['stockByStore'][number]>();
    const allLevels = item.variants.length ? item.variants.flatMap((v) => v.inventoryLevels) : item.inventoryLevels;
    for (const l of allLevels) {
      const row = stores.get(l.warehouseId) ?? {
        warehouseId: l.warehouseId,
        warehouseName: l.warehouse.name,
        sellsOnline: l.warehouse.sellsOnline && l.warehouse.status === 'ACTIVE',
        onHand: 0,
        reserved: 0,
        available: 0,
      };
      row.onHand += Number(l.quantity);
      row.reserved += Number(l.reservedQty);
      row.available = row.onHand - row.reserved;
      stores.set(l.warehouseId, row);
    }

    const specs = Array.isArray(item.specs)
      ? (item.specs as { label?: unknown; value?: unknown }[])
          .filter((s) => typeof s?.label === 'string' && typeof s?.value === 'string')
          .map((s) => ({ label: s.label as string, value: s.value as string }))
      : [];

    return {
      success: true,
      data: {
        id: item.id,
        name: item.name,
        sku: item.sku,
        barcode: item.barcode,
        unit: item.unit,
        description: item.description,
        shortDescription: item.shortDescription,
        itemType: item.itemType,
        status: item.status,
        categoryId: item.categoryId,
        brandId: item.brandId,
        preferredSupplierId: item.preferredSupplierId,
        reorderPoint: num(item.reorderPoint),
        sellingPrice: num(item.sellingPrice),
        compareAtPrice: num(item.compareAtPrice),
        averageCost: Number(item.averageCost),
        slug: item.slug,
        isPublished: item.isPublished,
        publishedAt: item.publishedAt?.toISOString() ?? null,
        requiresPrepayment: item.requiresPrepayment,
        tags: item.tags,
        highlights: item.highlights,
        specs,
        images: item.images.map((i) => ({ id: i.id, url: i.url, publicId: i.publicId ?? '', alt: i.alt ?? '', width: i.width, height: i.height })),
        options,
        variants: item.variants.map((v) => ({
          id: v.id,
          sku: v.sku,
          barcode: v.barcode,
          attributes: attributesOf(v),
          sellingPrice: num(v.sellingPrice),
          compareAtPrice: num(v.compareAtPrice),
          imageUrl: v.image?.url ?? null,
          status: v.status,
          ...sumLevels(v.inventoryLevels),
        })),
        stockByStore: [...stores.values()].sort((a, b) => a.warehouseName.localeCompare(b.warehouseName)),
        kitComponents: item.kitComponents.map((k) => ({
          id: k.componentItem.id,
          name: k.componentItem.name,
          sku: k.componentItem.sku,
          quantity: Number(k.quantity),
        })),
        hasStockHistory: hasHistory(item._count) || item.inventoryLevels.some((l) => Number(l.quantity) !== 0),
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      },
    };
  } catch (err) {
    return toActionError(err, 'Failed to load product');
  }
}

/* ─── Create ────────────────────────────────────────────────────────────── */

function sharedFields(data: ParsedProduct, slug: string) {
  return {
    name: data.name,
    sku: data.sku,
    barcode: data.variants.length ? null : data.barcode || null,
    unit: data.unit,
    description: data.description || null,
    shortDescription: data.shortDescription || null,
    categoryId: data.categoryId ?? null,
    brandId: data.brandId ?? null,
    preferredSupplierId: data.preferredSupplierId ?? null,
    reorderPoint: data.reorderPoint ?? null,
    sellingPrice: data.sellingPrice ?? null,
    compareAtPrice: data.compareAtPrice ?? null,
    status: data.status,
    slug,
    isPublished: data.isPublished,
    // Payment terms live on the top-level product only; a variant inherits
    // them, so there is one row to read and one to change.
    requiresPrepayment: data.requiresPrepayment,
    tags: [...new Set(data.tags)],
    highlights: data.highlights,
    specs: data.specs as Prisma.InputJsonValue,
    variantOptions: data.options.length ? (data.options as unknown as Prisma.InputJsonValue) : undefined,
  };
}

function variantFields(data: ParsedProduct, variant: ParsedProduct['variants'][number], imageIds: Map<string, string>) {
  const options = data.options as VariantOption[];
  return {
    sku: variant.sku,
    name: `${data.name} (${variantLabel(variant.attributes, options)})`,
    barcode: variant.barcode || null,
    unit: data.unit,
    categoryId: data.categoryId ?? null,
    reorderPoint: data.reorderPoint ?? null,
    sellingPrice: variant.sellingPrice ?? null,
    compareAtPrice: variant.compareAtPrice ?? null,
    variantAttributes: Object.fromEntries(options.map((o) => [o.name, variant.attributes[o.name]])),
    imageId: variant.imageUrl ? (imageIds.get(variant.imageUrl) ?? null) : null,
    status: data.status,
  };
}

export async function createProduct(input: ProductInput): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_CREATE);
    const organizationId = ctx.organization.id;

    const parsed = ProductSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Please check the form');
    const data = parsed.data;

    const checked = await validateProduct(organizationId, data, null);
    if ('error' in checked) return fail(checked.error);

    const product = await prisma.$transaction(async (tx) => {
      const parent = await tx.inventoryItem.create({
        data: {
          organizationId,
          itemType: ItemType.STANDARD,
          ...sharedFields(data, checked.slug),
          publishedAt: data.isPublished ? new Date() : null,
        },
      });

      const imageIds = new Map<string, string>();
      for (const [index, image] of data.images.entries()) {
        const row = await tx.productImage.create({
          data: {
            organizationId,
            inventoryItemId: parent.id,
            url: image.url,
            publicId: image.publicId,
            alt: image.alt || null,
            width: image.width ?? null,
            height: image.height ?? null,
            sortOrder: index,
          },
        });
        imageIds.set(image.url, row.id);
      }

      for (const variant of data.variants) {
        await tx.inventoryItem.create({
          data: {
            organizationId,
            itemType: ItemType.VARIANT,
            parentItemId: parent.id,
            preferredSupplierId: data.preferredSupplierId ?? null,
            ...variantFields(data, variant, imageIds),
          },
        });
      }
      return parent;
    });

    await createAuditLog({
      organizationId,
      userId: ctx.userId,
      action: 'inventory.item.created',
      entityType: 'InventoryItem',
      entityId: product.id,
      metadata: { sku: data.sku, variantCount: data.variants.length, published: data.isPublished },
    });

    await queueImageSearchIndexing(organizationId, product.id);
    return { success: true, data: { id: product.id } };
  } catch (err) {
    if (p2002(err)) return fail('A SKU or web address you used is already taken. Try a different one.');
    return toActionError(err, 'Failed to create product');
  }
}

/* ─── Update ────────────────────────────────────────────────────────────── */

export async function updateProduct(productId: string, input: ProductInput): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_EDIT);
    const organizationId = ctx.organization.id;

    const parsed = ProductSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Please check the form');
    const data = parsed.data;

    const existing = await prisma.inventoryItem.findFirst({
      where: { id: productId, organizationId, parentItemId: null },
      include: {
        images: true,
        inventoryLevels: { select: { quantity: true } },
        _count: { select: HISTORY_COUNT },
        variants: { include: { _count: { select: HISTORY_COUNT }, inventoryLevels: { select: { quantity: true } } } },
      },
    });
    if (!existing) return fail('Product not found');

    const checked = await validateProduct(organizationId, data, {
      id: existing.id,
      itemType: existing.itemType,
      variantIds: existing.variants.map((v) => v.id),
    });
    if ('error' in checked) return fail(checked.error);

    // A product that already holds stock can't switch to variants: the stock
    // would belong to neither variant. It has to be moved out first.
    const parentHasStock = hasHistory(existing._count) || existing.inventoryLevels.some((l) => Number(l.quantity) !== 0);
    const activeVariantsBefore = existing.variants.filter((v) => v.status !== ItemStatus.ARCHIVED);
    if (activeVariantsBefore.length === 0 && data.variants.length > 0 && parentHasStock) {
      return fail(
        'This product already has stock or sales history, so it can’t be split into variants. Create a new product with variants instead, and archive this one.',
      );
    }

    const options = data.options as VariantOption[];
    const removedImages: string[] = [];

    await prisma.$transaction(async (tx) => {
      await tx.inventoryItem.update({
        where: { id: productId },
        data: {
          ...sharedFields(data, checked.slug),
          variantOptions: data.options.length ? (data.options as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
          publishedAt: data.isPublished ? (existing.publishedAt ?? new Date()) : null,
        },
      });

      // Images: keep by URL, add new, remove the rest.
      const imageIds = new Map<string, string>();
      const incomingUrls = new Set(data.images.map((i) => i.url));
      for (const [index, image] of data.images.entries()) {
        const current = existing.images.find((i) => i.url === image.url);
        const fields = { alt: image.alt || null, sortOrder: index };
        const row = current
          ? await tx.productImage.update({ where: { id: current.id }, data: fields })
          : await tx.productImage.create({
              data: {
                organizationId,
                inventoryItemId: productId,
                url: image.url,
                publicId: image.publicId,
                width: image.width ?? null,
                height: image.height ?? null,
                ...fields,
              },
            });
        imageIds.set(image.url, row.id);
      }
      const staleImages = existing.images.filter((i) => !incomingUrls.has(i.url));
      if (staleImages.length) {
        await tx.productImage.deleteMany({ where: { id: { in: staleImages.map((i) => i.id) } } });
        removedImages.push(...staleImages.map((i) => i.publicId).filter((p): p is string => Boolean(p)));
      }

      // Variants: match by id, or by combination (so re-adding an archived
      // "Red / M" revives it with its history instead of making a duplicate).
      const keptIds = new Set<string>();
      for (const variant of data.variants) {
        const match =
          (variant.id && existing.variants.find((v) => v.id === variant.id)) ||
          existing.variants.find(
            (v) => !keptIds.has(v.id) && combinationKey((v.variantAttributes as Record<string, string>) ?? {}, options) === combinationKey(variant.attributes, options),
          );
        const fields = variantFields(data, variant, imageIds);
        if (match) {
          keptIds.add(match.id);
          await tx.inventoryItem.update({ where: { id: match.id }, data: { ...fields, preferredSupplierId: data.preferredSupplierId ?? null } });
        } else {
          await tx.inventoryItem.create({
            data: {
              organizationId,
              itemType: ItemType.VARIANT,
              parentItemId: productId,
              preferredSupplierId: data.preferredSupplierId ?? null,
              ...fields,
            },
          });
        }
      }

      // Removed variants: delete if untouched, otherwise archive to keep history intact.
      for (const variant of existing.variants.filter((v) => !keptIds.has(v.id))) {
        const used = hasHistory(variant._count) || variant.inventoryLevels.some((l) => Number(l.quantity) !== 0);
        if (used) {
          if (variant.status !== ItemStatus.ARCHIVED) {
            await tx.inventoryItem.update({ where: { id: variant.id }, data: { status: ItemStatus.ARCHIVED, imageId: null } });
          }
        } else {
          await tx.inventoryLevel.deleteMany({ where: { inventoryItemId: variant.id } });
          await tx.inventoryItem.delete({ where: { id: variant.id } });
        }
      }
    });

    for (const publicId of removedImages) void destroyAsset(publicId);

    await createAuditLog({
      organizationId,
      userId: ctx.userId,
      action: 'inventory.item.updated',
      entityType: 'InventoryItem',
      entityId: productId,
      metadata: {
        variantCount: data.variants.length,
        published: data.isPublished,
        ...(existing.isPublished !== data.isPublished ? { publishedChanged: true } : {}),
      },
    });

    await queueImageSearchIndexing(organizationId, productId);

    return { success: true, data: undefined };
  } catch (err) {
    if (p2002(err)) return fail('A SKU or web address you used is already taken. Try a different one.');
    return toActionError(err, 'Failed to save product');
  }
}

/** Quick publish/unpublish from the list, with the same checks as the editor. */
export async function setProductPublished(productId: string, isPublished: boolean): Promise<ActionResult> {
  const product = await getProduct(productId);
  if (!product.success) return product;
  const p = product.data;
  return updateProduct(productId, {
    ...p,
    isPublished,
    slug: p.slug ?? '',
    images: p.images.map(({ id: _id, ...i }) => i),
    variants: p.variants
      .filter((v) => v.status !== ItemStatus.ARCHIVED)
      .map((v) => ({ id: v.id, sku: v.sku, barcode: v.barcode, attributes: v.attributes, sellingPrice: v.sellingPrice, compareAtPrice: v.compareAtPrice, imageUrl: v.imageUrl })),
  });
}

/* ─── Search by image ───────────────────────────────────────────────────── */

/**
 * After a save: queue an embedding for every new image (instant, no model
 * call), then embed them once the vendor's response has gone out — the save
 * never waits on Gemini. Removed images took their embeddings with them (the
 * rows cascade). Anything this run can't finish (no budget, a 429, a crash)
 * stays PENDING for /api/cron/index-product-images. Never fails the save.
 */
async function queueImageSearchIndexing(organizationId: string, productId: string): Promise<void> {
  try {
    const queued = await syncProductImageEmbeddings(organizationId, productId);
    if (!queued) return;
    after(async () => {
      try {
        await indexPendingImages({ organizationId, productId, limit: 12 });
      } catch (err) {
        console.warn('[visual-search] post-save indexing failed; the cron will retry', err instanceof Error ? err.message : err);
      }
    });
  } catch (err) {
    console.warn('[visual-search] could not queue image indexing', err instanceof Error ? err.message : err);
  }
}

/** How many of a product's photos are ready for search by image. */
export async function getProductImageSearchStatus(productId: string): Promise<ActionResult<ProductImageSearchStatus>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_VIEW);
    return { success: true, data: await productImageSearchStatus(ctx.organization.id, productId) };
  } catch (err) {
    return toActionError(err, 'Failed to load image search status');
  }
}

/** "Try again" for photos that couldn't be prepared. Scoped to the caller's own organisation. */
export async function retryProductImageSearch(productId: string): Promise<ActionResult<{ queued: number }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_EDIT);
    const organizationId = ctx.organization.id;

    const product = await prisma.inventoryItem.findFirst({
      where: { id: productId, organizationId, parentItemId: null },
      select: { id: true },
    });
    if (!product) return fail('Product not found');

    const queued = await requeueProductImages(organizationId, productId);
    after(async () => {
      try {
        await indexPendingImages({ organizationId, productId, limit: 12 });
      } catch (err) {
        console.warn('[visual-search] retry indexing failed; the cron will retry', err instanceof Error ? err.message : err);
      }
    });
    return { success: true, data: { queued } };
  } catch (err) {
    return toActionError(err, 'Failed to retry');
  }
}
