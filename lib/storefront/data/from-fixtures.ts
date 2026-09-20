/*
 * lib/storefront/data/from-fixtures.ts
 *
 * The demo catalogue, kept for tests (and for an explicit local demo — see
 * ./current.ts). It is one global dataset, so every slug resolves to the
 * same products: the suites that assert tenant isolation do so by watching
 * the scope each read carries, not by owning separate fixtures.
 */
import { CATEGORIES } from '../mock/categories';
import { BRANDS } from '../mock/brands';
import { PRODUCTS } from '../mock/products';
import { COLLECTIONS } from '../mock/collections';
import { REVIEWS_BY_PRODUCT } from '../mock/reviews';
import { COMPANIONS } from '../mock/companions';
import { buildCatalogue, type Catalogue, type CompanionRule } from './catalogue';

/* The demo store's "goes well with" settings — what a merchant would pick in
 * Inventory › Categories, written down by slug for readability. */
function fixtureCompanions(): Map<string, CompanionRule> {
  const idBySlug = new Map(CATEGORIES.map((c) => [c.slug, c.id]));
  const out = new Map<string, CompanionRule>();
  for (const [slug, rule] of Object.entries(COMPANIONS)) {
    const id = idBySlug.get(slug);
    if (!id) continue;
    out.set(id, {
      title: rule.title,
      categoryIds: rule.categories.map((s) => idBySlug.get(s)).filter((v): v is string => Boolean(v)),
    });
  }
  return out;
}

let cached: Catalogue | null = null;

export function fixtureCatalogue(organizationSlug: string): Catalogue {
  if (cached && cached.organizationSlug === organizationSlug) return cached;
  cached = buildCatalogue({
    organizationSlug,
    storeName: 'Demo Store',
    currency: PRODUCTS[0]?.currency ?? 'NGN',
    /* The demo store's policy — demo data like the products beside it. */
    returnWindowDays: 30,
    products: PRODUCTS,
    categories: CATEGORIES,
    brands: BRANDS,
    collections: COLLECTIONS,
    reviewsFor: async (productId) => REVIEWS_BY_PRODUCT.get(productId) ?? [],
    companions: fixtureCompanions(),
    /* The fixtures have no orders, so nothing is "bought together" — the
     * demo store says so by showing no such rail, rather than inventing one. */
  });
  return cached;
}
