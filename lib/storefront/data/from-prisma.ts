/*
 * lib/storefront/data/from-prisma.ts
 *
 * The merchant's real records → the storefront's catalogue shapes.
 *
 * What a shopper may see is decided HERE, once:
 *   - products: published, active, and (for a product with variants) only
 *     its active variants;
 *   - stock: what's available in stores the merchant marked "sells online",
 *     minus anything already reserved for an order;
 *   - categories: visible, and not inside a hidden one;
 *   - collections: visible.
 *
 * Money crosses here too: the admin stores major units (₦5,000.00 as a
 * Decimal), the storefront works in minor units (kobo), like Paystack.
 *
 * Scale note: this loads the whole published catalogue for one store and the
 * query engine in ../catalog.ts filters it in memory. That is deliberate for
 * now — it keeps search, facets and sorting as one implementation — and it is
 * memoised per request (../data/current.ts). A merchant with thousands of
 * products will want the filters pushed into SQL; the seam for that is this
 * file plus listProducts, and nothing above them changes.
 */
import { prisma } from '@/lib/prisma';
import { loadLiveCampaignPrices, type SalePrice } from './campaign-prices';
import type { Prisma } from '@/lib/generated/prisma/client';
import type {
  Brand,
  Category,
  Collection,
  Money,
  Product,
  ProductImage,
  ReviewSummary,
  ProductOption,
  ProductTag,
  ProductVariant,
  SortKey,
} from '../types';
import { urlKey } from '../product-helpers';
import { normalizeVariantOptions, PRODUCT_TAGS, type VariantOption } from '@/features/inventory/product-rules';
import { NO_RATING } from '../reviews/rules';
import { listPublishedReviews, ratingSummaries } from '../reviews/read';
import { listAnsweredQuestions } from '../questions/read';
import { buildCatalogue, emptyCatalogue, type Catalogue, type CompanionRule } from './catalogue';
import { boughtTogetherFromDb } from './bought-together';

const CURRENCY = 'NGN';
const VALID_TAGS = new Set<string>(PRODUCT_TAGS.map((t) => t.value));

/** ₦5,000.00 (Decimal) → 500000 kobo. */
function toMinor(value: Prisma.Decimal | null | undefined): Money | null {
  if (value === null || value === undefined) return null;
  return Math.round(Number(value) * 100);
}

/** Stable across the whole store, so one colour filters every product that offers it. */
export function optionValueId(optionName: string, label: string): string {
  return `ov_${urlKey(optionName)}_${urlKey(label)}`;
}

const LEVEL_SELECT = {
  select: { quantity: true, reservedQty: true, warehouse: { select: { sellsOnline: true, status: true } } },
} as const;

/** What a shopper could actually buy right now. */
function onlineStock(levels: { quantity: Prisma.Decimal; reservedQty: Prisma.Decimal; warehouse: { sellsOnline: boolean; status: string } }[]): number {
  return levels.reduce((sum, level) => {
    if (!level.warehouse.sellsOnline || level.warehouse.status !== 'ACTIVE') return sum;
    return sum + Math.max(0, Number(level.quantity) - Number(level.reservedQty));
  }, 0);
}

const SORT_BY_ENUM: Record<string, SortKey> = {
  RELEVANCE: 'relevance',
  NEWEST: 'newest',
  PRICE_ASC: 'price-asc',
  PRICE_DESC: 'price-desc',
  BESTSELLING: 'bestselling',
};

/* ─── Categories ────────────────────────────────────────────────────────── */

type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  description: string | null;
  imageUrl: string | null;
  isVisible: boolean;
  isFeatured: boolean;
  sortOrder: number;
};

/** Visible categories only, and a hidden category hides everything beneath it. */
function mapCategories(rows: CategoryRow[]): Category[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const visible = (row: CategoryRow): boolean => {
    let current: CategoryRow | undefined = row;
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      if (!current.isVisible) return false;
      seen.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return true;
  };

  const pathOf = (row: CategoryRow): string[] => {
    const path: string[] = [];
    let current: CategoryRow | undefined = row;
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      path.unshift(current.slug);
      seen.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return path;
  };

  return rows
    .filter(visible)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((row) => {
      const path = pathOf(row);
      return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        parentId: row.parentId && byId.has(row.parentId) ? row.parentId : null,
        level: path.length - 1,
        path,
        description: row.description ?? '',
        imageUrl: row.imageUrl ?? '',
        featured: row.isFeatured,
      };
    });
}

/* ─── Products ──────────────────────────────────────────────────────────── */

const PRODUCT_INCLUDE = {
  images: { orderBy: { sortOrder: 'asc' } },
  brand: { select: { id: true, name: true, slug: true } },
  inventoryLevels: LEVEL_SELECT,
  variants: {
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    include: { inventoryLevels: LEVEL_SELECT },
  },
} satisfies Prisma.InventoryItemInclude;

type ProductRow = Prisma.InventoryItemGetPayload<{ include: typeof PRODUCT_INCLUDE }>;

function mapProduct(
  row: ProductRow,
  categoryPathIds: Map<string, string[]>,
  soldCount: number,
  rating: ReviewSummary,
  /** sale prices in force right now, keyed by InventoryItem id */
  salePrices?: Map<string, SalePrice>,
): Product | null {
  // A product must be reachable by URL; admin always assigns a slug.
  if (!row.slug) return null;

  const attributesOf = (v: { variantAttributes: Prisma.JsonValue }) => (v.variantAttributes as Record<string, string> | null) ?? {};
  const optionDefs: VariantOption[] = normalizeVariantOptions(row.variantOptions, row.variants.map(attributesOf));

  const options: ProductOption[] = optionDefs
    .filter((o) => o.values.length > 0)
    .map((o) => ({
      id: `opt_${urlKey(o.name)}`,
      name: o.name,
      kind: o.kind,
      values: o.values.map((v) => ({ id: optionValueId(o.name, v.label), label: v.label, ...(v.swatch ? { swatch: v.swatch } : {}) })),
    }));

  /*
   * A live campaign replaces the price and pushes the old one into the
   * strike-through — which is what makes that strike-through TRUE: it is
   * what this shop was charging until the sale started, snapshotted when the
   * campaign was scheduled (lib/storefront/data/campaign-prices.ts).
   *
   * `sellingPrice` is never edited by a campaign, so when the window closes
   * the real price is simply there again.
   */
  const saleFor = (itemId: string, listed: number | null, compareAt: number | null) => {
    const sale = salePrices?.get(itemId);
    if (!sale) return { price: listed, compareAtPrice: compareAt };
    // Campaign prices are major units, like everything in the admin; the
    // storefront counts in kobo (AGENTS: the mapper is the only converter).
    const minor = (major: number) => Math.round(major * 100);
    return { price: minor(sale.price), compareAtPrice: minor(sale.originalPrice) };
  };

  const basePrice = toMinor(row.sellingPrice);
  const baseCompareAt = toMinor(row.compareAtPrice);
  const base = saleFor(row.id, basePrice, baseCompareAt);

  const variants: ProductVariant[] = row.variants.length
    ? row.variants.map((variant) => {
        const attributes = attributesOf(variant);
        return {
          id: variant.id,
          sku: variant.sku,
          optionValueIds: optionDefs
            .map((o) => (attributes[o.name] ? optionValueId(o.name, attributes[o.name]) : null))
            .filter((id): id is string => id !== null),
          ...(() => {
            const listed = toMinor(variant.sellingPrice) ?? basePrice ?? 0;
            const compareAt = toMinor(variant.compareAtPrice) ?? baseCompareAt;
            const sale = saleFor(variant.id, listed, compareAt);
            return { price: sale.price ?? 0, compareAtPrice: sale.compareAtPrice };
          })(),
          stock: onlineStock(variant.inventoryLevels),
          imageId: variant.imageId,
        };
      })
    : [
        {
          // A product without variants still needs one buyable unit. Its id is
          // the product's own InventoryItem id, so a cart line always names a
          // real stock record either way.
          id: row.id,
          sku: row.sku,
          optionValueIds: [],
          price: base.price ?? 0,
          compareAtPrice: base.compareAtPrice,
          stock: onlineStock(row.inventoryLevels),
          imageId: row.images[0]?.id ?? null,
        },
      ];

  // Nothing buyable? Then it isn't a product a shopper can be shown.
  if (variants.every((v) => v.price <= 0)) return null;

  /* An image tied to exactly one option value (usually a colour) lets the
   * gallery follow the shopper's choice. Only set when every variant using
   * the image agrees on that value. */
  const imageOptionValue = new Map<string, string | undefined>();
  for (const image of row.images) {
    const users = row.variants.filter((v) => v.imageId === image.id);
    if (!users.length) continue;
    const shared = optionDefs
      .map((o) => {
        const labels = new Set(users.map((u) => attributesOf(u)[o.name]).filter(Boolean));
        return labels.size === 1 && o.values.length > 1 ? optionValueId(o.name, [...labels][0]) : null;
      })
      .find((id): id is string => id !== null);
    imageOptionValue.set(image.id, shared);
  }

  const images: ProductImage[] = row.images.map((image) => ({
    id: image.id,
    url: image.url,
    alt: image.alt || row.name,
    ...(imageOptionValue.get(image.id) ? { optionValueId: imageOptionValue.get(image.id)! } : {}),
  }));

  const prices = variants.map((v) => v.price);
  const specs = Array.isArray(row.specs)
    ? (row.specs as { label?: unknown; value?: unknown }[])
        .filter((s) => typeof s?.label === 'string' && typeof s?.value === 'string')
        .map((s) => ({ label: s.label as string, value: s.value as string }))
    : [];

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    brandId: row.brand?.id ?? '',
    brandName: row.brand?.name ?? '',
    categoryId: row.categoryId ?? '',
    categoryIds: row.categoryId ? (categoryPathIds.get(row.categoryId) ?? []) : [],
    shortDescription: row.shortDescription ?? '',
    description: row.description ?? '',
    highlights: row.highlights,
    specs,
    images,
    options,
    variants,
    priceFrom: Math.min(...prices),
    priceTo: Math.max(...prices),
    compareAtPrice: baseCompareAt ?? variants.map((v) => v.compareAtPrice).find((p): p is number => p !== null) ?? null,
    currency: CURRENCY,
    inStock: variants.some((v) => v.stock > 0),
    tags: row.tags.filter((t): t is ProductTag => VALID_TAGS.has(t)),
    rating,
    soldCount,
    requiresPrepayment: row.requiresPrepayment,
    createdAt: row.createdAt.toISOString(),
    relatedIds: [],
  };
}

/** Units sold per product, variants rolled up — the only real "bestselling" signal we have. */
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

/* ─── Collections ───────────────────────────────────────────────────────── */

type CollectionRow = Prisma.CollectionGetPayload<{ include: { items: { select: { inventoryItemId: true; position: true } } } }>;

function mapCollection(row: CollectionRow, categories: Category[], sellableIds: Set<string>): Collection | null {
  const base = {
    id: row.id,
    slug: row.slug,
    name: row.name,
    tagline: row.tagline ?? '',
    description: row.description ?? '',
    imageUrl: row.imageUrl ?? '',
    ...(row.heroImageUrl ? { heroImageUrl: row.heroImageUrl } : {}),
    sort: SORT_BY_ENUM[row.sort] ?? 'relevance',
    featured: row.isFeatured,
  };

  if (row.kind === 'CURATED') {
    const productIds = [...row.items]
      .sort((a, b) => a.position - b.position)
      .map((i) => i.inventoryItemId)
      .filter((id) => sellableIds.has(id));
    return { ...base, rule: { kind: 'curated', productIds } };
  }

  const category = row.matchCategoryId ? categories.find((c) => c.id === row.matchCategoryId) : undefined;
  // The rule pointed at a category the shopper can't reach any more.
  if (row.matchCategoryId && !category) return null;

  const minPrice = toMinor(row.matchMinPrice);
  const maxPrice = toMinor(row.matchMaxPrice);
  return {
    ...base,
    rule: {
      kind: 'dynamic',
      match: {
        ...(category ? { categoryPath: category.path } : {}),
        ...(row.matchTag && VALID_TAGS.has(row.matchTag) ? { tag: row.matchTag as ProductTag } : {}),
        ...(minPrice !== null ? { minPrice } : {}),
        ...(maxPrice !== null ? { maxPrice } : {}),
        ...(row.matchCreatedWithinDays !== null ? { createdWithinDays: row.matchCreatedWithinDays } : {}),
      },
    },
  };
}

/* ─── Entry point ───────────────────────────────────────────────────────── */

/** The published catalogue of one store. Returns null when the store doesn't exist. */
export async function loadCatalogueFromDb(organizationSlug: string): Promise<Catalogue | null> {
  const organization = await prisma.organization.findFirst({
    where: { slug: organizationSlug, status: 'ACTIVE' },
    select: { id: true, name: true, slug: true, returnWindowDays: true },
  });
  if (!organization) return null;

  const organizationId = organization.id;
  const [categoryRows, productRows, brandRows, collectionRows, sold, ratings, salePrices] = await Promise.all([
    prisma.category.findMany({
      where: { organizationId },
      select: {
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
      },
    }),
    prisma.inventoryItem.findMany({
      where: { organizationId, parentItemId: null, isPublished: true, status: 'ACTIVE' },
      include: PRODUCT_INCLUDE,
    }),
    prisma.brand.findMany({
      where: { organizationId },
      select: { id: true, name: true, slug: true, logoUrl: true, description: true },
    }),
    prisma.collection.findMany({
      where: { organizationId, isVisible: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { items: { select: { inventoryItemId: true, position: true } } },
    }),
    soldCounts(organizationId),
    ratingSummaries(organizationId),
    /* Whatever is on sale at this instant. Built into the catalogue, so the
     * price shown and the price charged are the same number. */
    loadLiveCampaignPrices(organizationId),
  ]);

  const categories = mapCategories(categoryRows);
  // buildCatalogue drops any id that isn't a visible category of this store.
  const companions = new Map<string, CompanionRule>(
    categoryRows
      .filter((row) => row.companionIds.length > 0)
      .map((row) => [row.id, { title: row.companionTitle, categoryIds: row.companionIds }]),
  );
  const visibleCategoryIds = new Set(categories.map((c) => c.id));

  // Ancestor ids per category, so a product in "Skirts" also lists under "Fashion".
  const categoryPathIds = new Map<string, string[]>();
  for (const category of categories) {
    const ids: string[] = [];
    let current: Category | undefined = category;
    while (current) {
      ids.unshift(current.id);
      current = current.parentId ? categories.find((c) => c.id === current!.parentId) : undefined;
    }
    categoryPathIds.set(category.id, ids);
  }

  const products = productRows
    .map((row) =>
      mapProduct(
        // A product filed in a hidden category is still for sale — it just
        // isn't reachable by browsing.
        { ...row, categoryId: row.categoryId && visibleCategoryIds.has(row.categoryId) ? row.categoryId : null },
        categoryPathIds,
        sold.get(row.id) ?? 0,
        // A product nobody has reviewed is unrated, not zero-rated — see the
        // note on the empty state in components/storefront/product/product-reviews.tsx.
        ratings.get(row.id) ?? NO_RATING,
        salePrices,
      ),
    )
    .filter((p): p is Product => p !== null);

  const usedBrandIds = new Set(products.map((p) => p.brandId));
  const brands: Brand[] = brandRows
    .filter((b) => usedBrandIds.has(b.id))
    .map((b) => ({ id: b.id, slug: b.slug, name: b.name, logoUrl: b.logoUrl ?? '', description: b.description ?? '' }));

  const sellableIds = new Set(products.map((p) => p.id));
  const collections = collectionRows
    .map((row) => mapCollection(row, categories, sellableIds))
    .filter((c): c is Collection => c !== null);

  return buildCatalogue({
    organizationSlug: organization.slug,
    storeName: organization.name,
    currency: CURRENCY,
    returnWindowDays: organization.returnWindowDays,
    products,
    categories,
    brands,
    collections,
    /* Read on demand, and only ever the published ones — hidden reviews are
     * off the storefront entirely, including out of the average above. */
    reviewsFor: (productId) => listPublishedReviews(organizationId, productId),
    /* Only the ones the merchant answered: a question waiting in their inbox
     * is not store content, and an unanswered question on a product page is
     * an objection nobody replied to. */
    questionsFor: (productId) => listAnsweredQuestions(organizationId, productId),
    companions,
    boughtTogether: (productId) => boughtTogetherFromDb(organizationId, productId),
  });
}

export { emptyCatalogue };
