/*
 * lib/social/product-facts.ts
 *
 * The only description of a product that the copywriter is ever given.
 *
 * Two jobs, and they are the same job seen from two sides:
 *
 *  1. TENANCY. A product is loaded by `{ id, organizationId }` together, with
 *     the organizationId taken from the session by the caller — never from
 *     the form. A product id belonging to another store is simply not found,
 *     so a merchant cannot post somebody else's catalogue by editing a
 *     hidden input.
 *
 *  2. TRUTH. Everything in `ProductFacts` came out of the merchant's own
 *     rows. The model is told to write only from these fields, and
 *     lib/ai/social/validate.ts checks the output against them afterwards —
 *     a price, a material or a promise that isn't in here is not something
 *     Gemini may put in a caption. That is why the price arrives already
 *     formatted: a model handed a raw number invents a currency.
 *
 * The product URL is built here too, from the store's own domain via
 * lib/storefront/account/return-url.ts's `storeUrl`. The client never
 * supplies a link.
 */
import { prisma } from '@/lib/prisma';
import { formatMoney, formatMoneyRange } from '@/lib/format';
import { storeUrl } from '@/lib/storefront/account/return-url';

/** One image a merchant may attach, as the composer shows it. */
export interface ProductImageOption {
  id: string;
  url: string;
  alt: string | null;
}

/**
 * Verified product information. Every field is a fact from the database or
 * absent — there is no field here a caller can inject free text into.
 */
export interface ProductFacts {
  productId: string;
  name: string;
  description: string | null;
  shortDescription: string | null;
  /** Deepest-first path, e.g. ["Clothing", "Dresses"]. */
  categoryPath: string[];
  brandName: string | null;
  /** Already formatted in the org's currency — never a bare number. */
  priceLabel: string | null;
  /** e.g. ["Size: S, M, L", "Colour: Red, Blue"] — what a buyer can choose. */
  variantSummary: string[];
  /** Merchant-written selling points. */
  highlights: string[];
  /** Merchant-written spec rows, as "Label: value". */
  specs: string[];
  /** Merchant's own tags, useful for hashtags. */
  tags: string[];
  storeName: string;
  /**
   * The store's own words about itself — the opening of their published
   * About page, when they have one. Merchant-written, never generated.
   */
  storeDescription: string | null;
  /** The public storefront link, or null when the product isn't published. */
  productUrl: string | null;
  /** Whether shoppers can actually reach it — a caption shouldn't link a draft. */
  isPublished: boolean;
  images: ProductImageOption[];
}

type VariantOptionValue = { label?: string } | string;

/** Reads the parent's option schema into "Size: S, M, L" lines. */
function summariseVariants(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  const lines: string[] = [];

  for (const option of options) {
    if (typeof option !== 'object' || option === null) continue;
    const { name, values } = option as { name?: string; values?: VariantOptionValue[] };
    if (!name || !Array.isArray(values)) continue;

    const labels = values
      .map((value) => (typeof value === 'string' ? value : value?.label))
      .filter((label): label is string => Boolean(label));

    if (labels.length > 0) lines.push(`${name}: ${labels.join(', ')}`);
  }
  return lines;
}

/** Reads merchant-written spec rows into "Label: value" lines. */
function summariseSpecs(specs: unknown): string[] {
  if (!Array.isArray(specs)) return [];
  return specs
    .map((row) => {
      if (typeof row !== 'object' || row === null) return null;
      const { label, value } = row as { label?: string; value?: string };
      return label && value ? `${label}: ${value}` : null;
    })
    .filter((row): row is string => row !== null);
}

/** Walks a category up to its root, deepest last. */
async function categoryPath(organizationId: string, categoryId: string | null): Promise<string[]> {
  if (!categoryId) return [];

  const rows = await prisma.category.findMany({
    where: { organizationId },
    select: { id: true, name: true, parentId: true },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));

  const path: string[] = [];
  let current = byId.get(categoryId);
  // Bounded: a malformed parent cycle must not hang a request.
  for (let depth = 0; current && depth < 10; depth += 1) {
    path.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

/**
 * Loads one product's facts for this store, or null when the store doesn't
 * own it.
 *
 * `organizationId` MUST come from the session (getOrganizationContext), never
 * from client input — that pairing is the whole tenancy guarantee.
 */
export async function getProductFacts(
  organizationId: string,
  productId: string,
): Promise<ProductFacts | null> {
  const product = await prisma.inventoryItem.findFirst({
    // Both ids, together. This is the tenant check.
    where: { id: productId, organizationId, parentItemId: null },
    select: {
      id: true,
      name: true,
      description: true,
      shortDescription: true,
      highlights: true,
      specs: true,
      tags: true,
      slug: true,
      isPublished: true,
      sellingPrice: true,
      categoryId: true,
      variantOptions: true,
      brand: { select: { name: true } },
      images: {
        select: { id: true, url: true, alt: true },
        orderBy: { sortOrder: 'asc' },
      },
      variants: {
        where: { status: { not: 'ARCHIVED' } },
        select: { sellingPrice: true },
      },
      organization: {
        select: { name: true, slug: true, customStoreDomain: true },
      },
    },
  });

  if (!product) return null;

  /* Price: the product's own, or the range its variants actually sell at.
   * Formatted here so the model never sees a bare number to guess about. */
  const variantPrices = product.variants
    .map((variant) => (variant.sellingPrice === null ? null : Number(variant.sellingPrice)))
    .filter((price): price is number => price !== null);

  const own = product.sellingPrice === null ? null : Number(product.sellingPrice);
  const prices = [...(own === null ? [] : [own]), ...variantPrices];

  let priceLabel: string | null = null;
  if (prices.length > 0) {
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    priceLabel = min === max ? formatMoney(min) : formatMoneyRange(min, max);
  }

  /* Only a published product has a working public link, and the storefront
   * only serves one with a slug. Anything else gets no URL rather than a
   * link that 404s in front of a customer. */
  const productUrl =
    product.isPublished && product.slug
      ? storeUrl(product.organization, `/products/${product.slug}`)
      : null;

  return {
    productId: product.id,
    name: product.name,
    description: product.description,
    shortDescription: product.shortDescription,
    categoryPath: await categoryPath(organizationId, product.categoryId),
    brandName: product.brand?.name ?? null,
    priceLabel,
    variantSummary: summariseVariants(product.variantOptions),
    highlights: product.highlights,
    specs: summariseSpecs(product.specs),
    tags: product.tags,
    storeName: product.organization.name,
    storeDescription: await storeDescription(organizationId),
    productUrl,
    isPublished: product.isPublished,
    images: product.images.map((image) => ({ id: image.id, url: image.url, alt: image.alt })),
  };
}

/**
 * The merchant's own description of their store, for tone rather than fact.
 *
 * Taken from their published About page (features/settings/store-pages.ts) —
 * words they wrote and chose to show customers. Truncated, because the model
 * needs a sense of the shop, not the whole page. Nothing is generated: a
 * store with no About page simply has no description here.
 */
async function storeDescription(organizationId: string): Promise<string | null> {
  const page = await prisma.storePage.findFirst({
    where: { organizationId, kind: 'ABOUT', isPublished: true },
    select: { body: true },
  });
  if (!page?.body) return null;

  const plain = page.body.replace(/\s+/g, ' ').trim();
  return plain.length > 400 ? `${plain.slice(0, 400)}…` : plain;
}

/**
 * Narrows a set of image ids to the ones this product actually owns, in the
 * product's own order.
 *
 * The composer sends back image ids, and this is what stops those ids being
 * a way to attach an arbitrary URL — or another product's photo — to a post.
 */
export function resolveImageUrls(facts: ProductFacts, imageIds: string[]): string[] {
  const wanted = new Set(imageIds);
  return facts.images.filter((image) => wanted.has(image.id)).map((image) => image.url);
}
