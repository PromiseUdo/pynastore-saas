/*
 * lib/storefront/product-helpers.ts
 *
 * Pure catalogue helpers with no data source behind them. They live apart
 * from ./catalog.ts because client components reach them (through
 * ./cart.ts and ./use-cart-actions.ts) and catalog.ts now imports Prisma —
 * which must never be pulled into the browser bundle.
 */
import type { Collection, ListProductsParams, Product } from './types';
import { SPEC_VALUE_PREFIX } from './types';
import { normalise } from './search';

/** `Fit` + `Slim` → `spec:Fit:Slim`. See SPEC_VALUE_PREFIX in ./types. */
export function specValueId(label: string, value: string): string {
  return `${SPEC_VALUE_PREFIX}${label}${SPEC_VALUE_PREFIX}${value}`;
}

/** The inverse; null for anything that is a variant option-value id. */
export function parseSpecValueId(id: string): { label: string; value: string } | null {
  if (!id.startsWith(SPEC_VALUE_PREFIX)) return null;
  const [, label, value] = id.split(SPEC_VALUE_PREFIX);
  return label && value ? { label, value } : null;
}

/** 'Colour' → 'colour'; 'One size' → 'one-size'; '256GB' → '256gb'. */
export function urlKey(label: string): string {
  return normalise(label).replace(/\s+/g, '-');
}

/**
 * A collection's rule, expressed as a catalogue query.
 *
 * This is the ONE place the two kinds of collection stop differing: a curated
 * list becomes `productIds`, a rule becomes the ordinary filters. Everything
 * downstream — filtering, search-within, sorting, facets, paging — is the
 * same code path the category and search pages take, which is what makes
 * "smart" collections a data change rather than a feature.
 */
export function collectionQuery(collection: Collection): ListProductsParams {
  const { rule } = collection;
  if (rule.kind === 'curated') return { productIds: rule.productIds ?? [] };
  const match = rule.match ?? {};
  return {
    categoryPath: match.categoryPath,
    tag: match.tag,
    minPrice: match.minPrice,
    maxPrice: match.maxPrice,
    minRating: match.minRating,
    createdWithinDays: match.createdWithinDays,
  };
}

/* ---------------- variant helpers ---------------- */

export function findVariant(product: Product, optionValueIds: string[]): Product['variants'][number] | null {
  return (
    product.variants.find(
      (v) =>
        v.optionValueIds.length === optionValueIds.length &&
        v.optionValueIds.every((id) => optionValueIds.includes(id)),
    ) ?? null
  );
}

/** First in-stock variant, falling back to the first variant. */
export function defaultVariant(product: Product): Product['variants'][number] {
  return product.variants.find((v) => v.stock > 0) ?? product.variants[0];
}

/** The primary listing image for a product (colour-tied image of a variant, else first). */
export function variantImage(product: Product, variantId?: string): string {
  const variant = variantId ? product.variants.find((v) => v.id === variantId) : undefined;
  const byId = variant?.imageId ? product.images.find((i) => i.id === variant.imageId) : undefined;
  return byId?.url ?? product.images[0]?.url ?? '';
}

export function optionSummary(product: Product, optionValueIds: string[]): string {
  const labels: string[] = [];
  for (const opt of product.options) {
    const val = opt.values.find((v) => optionValueIds.includes(v.id));
    if (val) labels.push(val.label);
  }
  return labels.join(' · ');
}
