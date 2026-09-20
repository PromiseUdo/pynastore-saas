/*
 * Discovery data: shopping missions, budget bands and the store's currency.
 *
 * Everything here resolves against `catalog.ts`, which is the single place the
 * tenant's catalogue is read. That matters for two reasons:
 *
 *  1. Tenant isolation. When the catalogue moves from fixtures to Prisma, the
 *     scoping lands in catalog.ts and every mission / band / assistant result
 *     inherits it. Nothing in this file reaches past it.
 *  2. Honesty. A mission is only offered if its query actually returns
 *     products, and the budget bands are computed from the real price
 *     distribution — so neither can advertise something the store can't sell.
 */
import { listProducts, getCategoryTree, getBrands } from './catalog';
import { formatMoney } from './format';
import type { ListProductsParams, Money, StoreScope } from './types';
import type { IntentVocabulary } from '@/lib/ai/intent';

/* ────────────────────────────── currency ────────────────────────────── */

/*
 * The Organization model carries no currency column, so the store's currency
 * is taken from the catalogue it actually sells. Falls back to NGN only if the
 * catalogue is empty. Nothing in the UI hardcodes a symbol.
 */
export async function getStoreCurrency(store?: StoreScope): Promise<string> {
  const { items } = await listProducts({ store, perPage: 1 });
  return items[0]?.currency ?? 'NGN';
}

/** Minor units per major unit — 100 for kobo/cents. */
export const CURRENCY_SCALE = 100;

/* ────────────────────────────── missions ────────────────────────────── */

/*
 * A mission is "what I'm shopping FOR", which is not the same axis as a
 * category. Each maps to a real catalogue query — there is no mission
 * metadata on products, and inventing product↔mission relationships would be
 * fabricating data, so every mission is expressed as a category subtree
 * (optionally narrowed by tag or price) that genuinely exists.
 *
 * Missions whose query returns nothing are dropped, so a store without, say,
 * a sports department simply never shows "Gym".
 */
export interface MissionDef {
  id: string;
  label: string;
  /** one-line framing shown under the label */
  blurb: string;
  /** emoji keeps this dependency-free and reads well at small sizes */
  icon: string;
  match: ListProductsParams;
}

const MISSIONS: MissionDef[] = [
  { id: 'work',     label: 'Work',        blurb: 'Desk, commute and office',   icon: '💼', match: { categoryPath: ['computers'] } },
  { id: 'gym',      label: 'Gym',         blurb: 'Training and recovery',      icon: '🏋️', match: { categoryPath: ['fitness'] } },
  { id: 'travel',   label: 'Travel',      blurb: 'Trips, trails and packing',  icon: '🧳', match: { categoryPath: ['camping'] } },
  { id: 'home',     label: 'Home',        blurb: 'Make the space yours',       icon: '🏠', match: { categoryPath: ['home-living'] } },
  { id: 'gifting',  label: 'Gifts',       blurb: 'Something worth unwrapping', icon: '🎁', match: { categoryPath: ['jewelry'] } },
  { id: 'everyday', label: 'Everyday',    blurb: 'The things you reach for',   icon: '👟', match: { categoryPath: ['fashion'] } },
  { id: 'kitchen',  label: 'Cooking',     blurb: 'Kitchen and table',          icon: '🍳', match: { categoryPath: ['kitchen'] } },
  { id: 'selfcare', label: 'Self-care',   blurb: 'Skin, hair and fragrance',   icon: '🧴', match: { categoryPath: ['beauty'] } },
  { id: 'play',     label: 'Play',        blurb: 'Games, building and outside',icon: '🎲', match: { categoryPath: ['toys-games'] } },
];

export interface Mission extends MissionDef {
  productCount: number;
  /** representative imagery, taken from the products the mission resolves to */
  previewImages: string[];
}

/** Missions that actually have stock behind them, richest first. */
export async function getMissions(limit = 6, store?: StoreScope): Promise<Mission[]> {
  const resolved = await Promise.all(
    MISSIONS.map(async (m) => {
      const { items, total } = await listProducts({ ...m.match, store, perPage: 3, sort: 'bestselling' });
      return {
        ...m,
        productCount: total,
        previewImages: items.map((p) => p.images[0]?.url).filter((u): u is string => !!u),
      };
    }),
  );
  return resolved.filter((m) => m.productCount > 0).slice(0, limit);
}

export function getMissionById(id: string): MissionDef | undefined {
  return MISSIONS.find((m) => m.id === id);
}

/* ──────────────────────────── budget bands ──────────────────────────── */

export interface PriceBand {
  id: string;
  label: string;
  minPrice?: Money;
  maxPrice?: Money;
  productCount: number;
}

/*
 * Bands are derived from the catalogue's own price spread rather than fixed
 * tiers, so they stay meaningful whether the store sells ₦2,000 snacks or
 * ₦2,000,000 laptops. We cut at rounded quantiles of the real distribution.
 */
export async function getPriceBands(currency: string, store?: StoreScope): Promise<PriceBand[]> {
  const { items } = await listProducts({ store, perPage: 1000, sort: 'price-asc' });
  if (items.length < 4) return [];

  const prices = items.map((p) => p.priceFrom);
  const at = (q: number) => prices[Math.min(prices.length - 1, Math.floor(prices.length * q))];
  const cuts = [...new Set([at(0.25), at(0.5), at(0.75)].map(roundToNiceNumber))].sort((a, b) => a - b);

  const bands: PriceBand[] = [];
  let previous: Money | undefined;
  for (const cut of cuts) {
    bands.push({
      id: `under-${cut}`,
      label: `Under ${formatMoney(cut, currency)}`,
      minPrice: undefined,
      maxPrice: cut,
      productCount: prices.filter((p) => p <= cut).length,
    });
    previous = cut;
  }
  if (previous != null) {
    bands.push({
      id: `over-${previous}`,
      label: `${formatMoney(previous, currency)} & up`,
      minPrice: previous,
      productCount: prices.filter((p) => p > previous!).length,
    });
  }
  return bands.filter((b) => b.productCount > 0);
}

/** 143,720 → 150,000. Keeps band labels readable instead of exact quantiles. */
function roundToNiceNumber(minor: Money): Money {
  const major = minor / CURRENCY_SCALE;
  const magnitude = Math.pow(10, Math.max(0, String(Math.floor(major)).length - 2));
  return Math.max(magnitude, Math.ceil(major / magnitude) * magnitude) * CURRENCY_SCALE;
}

/* ───────────────────────── example queries ──────────────────────────── */

/*
 * The "Try:" chips under the hero input.
 *
 * Built from real leaf categories and a real price point from this store, so
 * every suggestion returns results when tapped. A hardcoded list would go
 * stale the moment a merchant's catalogue differs — and would advertise
 * departments they don't stock.
 */
export async function getExampleQueries(currency: string, count = 3, store?: StoreScope): Promise<string[]> {
  const tree = await getCategoryTree(store);

  // Leaves of the busiest departments make the most natural nouns.
  const leaves: { name: string; count: number }[] = [];
  const walk = (nodes: Awaited<ReturnType<typeof getCategoryTree>>) => {
    for (const n of nodes) {
      if (n.children.length) walk(n.children);
      else leaves.push({ name: n.name, count: n.productCount });
    }
  };
  walk(tree);

  const best = leaves.sort((a, b) => b.count - a.count).slice(0, count);
  if (!best.length) return [];

  const { items } = await listProducts({ store, perPage: 1000, sort: 'price-asc' });
  const median = items[Math.floor(items.length / 2)]?.priceFrom;
  const budget = median ? roundToNiceNumber(median) : undefined;
  // Only offer "best rated" where ratings exist; otherwise demonstrate the
  // signal this store does have — what's actually selling.
  const rated = items.some((p) => p.rating.count > 0);

  return best.map((leaf, i) =>
    // Vary the phrasing so the chips demonstrate more than one shape of query.
    i === 0 && budget
      ? `${leaf.name} under ${formatMoney(budget, currency)}`
      : i === 1
        ? `${rated ? 'Best rated' : 'Best selling'} ${leaf.name.toLowerCase()}`
        : leaf.name,
  );
}

/* ──────────────────────── parser vocabulary ─────────────────────────── */

/*
 * The intent parser matches against the tenant's own category and brand
 * names. Built here (server-side) and handed in, so lib/ai never reaches into
 * the catalogue itself and stays a pure, testable unit.
 */
export async function buildIntentVocabulary(currency: string, store?: StoreScope): Promise<IntentVocabulary> {
  const [tree, brands] = await Promise.all([getCategoryTree(store), getBrands(store)]);

  const categories: { name: string; path: string[] }[] = [];
  const walk = (nodes: Awaited<ReturnType<typeof getCategoryTree>>) => {
    for (const n of nodes) {
      categories.push({ name: n.name, path: n.path });
      if (n.children.length) walk(n.children);
    }
  };
  walk(tree);

  return {
    categories,
    brands: brands.map((b) => ({ name: b.name, slug: b.slug })),
    currencyScale: CURRENCY_SCALE,
    formatMoney: (minor) => formatMoney(minor, currency),
  };
}
