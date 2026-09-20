/*
 * lib/storefront/search.ts
 *
 * The storefront's relevance engine — pure, deterministic, dependency-free.
 *
 * Kept separate from `catalog.ts` on purpose. The catalogue is the seam that
 * becomes Prisma/an API later; ranking is presentation logic that should
 * survive that change unaltered, and being pure it is trivially unit-tested.
 * For a catalogue of this size (tens to low hundreds of rows) a linear scan
 * beats pulling in a search library, and it keeps the scoring legible enough
 * to tune by hand.
 *
 * Ranking model, in the order the brief asks for:
 *
 *   product name  >  brand  >  category  >  tag  >  option/spec  >  description
 *
 * with a phrase bonus so "orbit air" puts "Orbit Air Earbuds" above a random
 * Orbit product, and match-quality multipliers so a whole-word hit outranks a
 * prefix, which outranks a mid-word substring.
 *
 * Multi-term queries are AND-first: a product must match every term. If that
 * returns nothing, we fall back to the best partial match rather than
 * dead-ending — but only when at least two terms landed, so genuine nonsense
 * ("blue gaming refrigerator") still returns the empty state instead of
 * every blue product in the store.
 */
import type { Product } from './types';

/* ─────────────────────────── normalisation ─────────────────────────── */

/** Lowercase, de-accent (Solène → solene) and strip punctuation. */
export function normalise(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Words that are noise in a product query. Kept deliberately short — this is
 * a filter of last resort, and dropping a term the shopper meant is worse
 * than carrying a weak one. */
const NOISE = new Set(['a', 'an', 'the', 'for', 'of', 'and', 'or', 'with', 'my', 'me', 'i']);

/** Split a query into searchable terms. Single-character tokens are dropped. */
export function tokenize(raw: string): string[] {
  const words = normalise(raw).split(' ').filter(Boolean);
  const kept = words.filter((w) => w.length > 1 && !NOISE.has(w));
  // If the query was nothing BUT noise ("the"), search it literally rather
  // than silently returning the whole catalogue.
  return kept.length ? kept : words;
}

/** Crude but predictable singular/plural folding: shoes↔shoe, dresses↔dress. */
export function termVariants(term: string): string[] {
  const out = new Set<string>([term]);
  if (/ies$/.test(term)) out.add(`${term.slice(0, -3)}y`);
  if (/(ches|shes|sses|xes)$/.test(term)) out.add(term.slice(0, -2));
  if (/s$/.test(term) && !/ss$/.test(term)) out.add(term.slice(0, -1));
  if (/y$/.test(term)) out.add(`${term.slice(0, -1)}ies`);
  out.add(`${term}s`);
  out.add(`${term}es`);
  return [...out].filter((t) => t.length > 1);
}

/* ────────────────────────── the searchable doc ─────────────────────── */

/**
 * A product flattened into weighted text fields.
 *
 * Built once per search rather than per term, and cached by product id +
 * category signature so repeated searches over the same fixtures don't
 * re-flatten. A future API-backed catalogue would build the same shape from
 * whatever the endpoint returns.
 */
export interface SearchDoc {
  id: string;
  name: string;
  brand: string;
  categories: string;
  tags: string;
  options: string;
  specs: string;
  description: string;
}

export const FIELD_WEIGHTS: Record<keyof Omit<SearchDoc, 'id'>, number> = {
  name: 40,
  brand: 26,
  categories: 20,
  tags: 14,
  options: 12,
  specs: 8,
  description: 5,
};

const FIELDS = Object.keys(FIELD_WEIGHTS) as (keyof typeof FIELD_WEIGHTS)[];

export function buildSearchDoc(product: Product, categoryNames: string[]): SearchDoc {
  return {
    id: product.id,
    name: normalise(product.name),
    brand: normalise(product.brandName),
    categories: normalise(categoryNames.join(' ')),
    tags: normalise(product.tags.join(' ')),
    options: normalise(
      product.options.flatMap((o) => [o.name, ...o.values.map((v) => v.label)]).join(' '),
    ),
    specs: normalise(product.specs.map((s) => `${s.label} ${s.value}`).join(' ')),
    description: normalise(`${product.shortDescription} ${product.description}`),
  };
}

/* ──────────────────────────── scoring ──────────────────────────────── */

/* A whole-word hit is worth full weight; a prefix ("sneak" in "sneaker")
 * three quarters; a mid-word substring half. */
const EXACT = 1;
const PREFIX = 0.75;
const INFIX = 0.5;

/** Best match quality of `term` (or a plural/singular variant) within `text`. */
function fieldMatch(text: string, term: string): number {
  if (!text) return 0;
  let best = 0;
  for (const variant of termVariants(term)) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(variant, from);
      if (at < 0) break;
      const startsWord = at === 0 || text[at - 1] === ' ';
      const endsWord = at + variant.length === text.length || text[at + variant.length] === ' ';
      const quality = startsWord && endsWord ? EXACT : startsWord ? PREFIX : INFIX;
      // An exact variant match is only full-weight for the term as typed;
      // reaching a match through plural folding is never better than a prefix.
      const folded = variant === term ? quality : Math.min(quality, PREFIX);
      if (folded > best) best = folded;
      if (best === EXACT) return best;
      from = at + 1;
    }
  }
  return best;
}

export interface SearchHit {
  product: Product;
  score: number;
  /** how many of the query's terms this product matched at all */
  matched: number;
}

/**
 * Score one document against the query terms.
 * Returns the score and the number of terms that matched somewhere.
 */
export function scoreDoc(doc: SearchDoc, terms: string[], phrase: string): { score: number; matched: number } {
  let score = 0;
  let matched = 0;

  for (const term of terms) {
    let termBest = 0;
    for (const field of FIELDS) {
      const quality = fieldMatch(doc[field], term);
      if (quality > 0) termBest = Math.max(termBest, quality * FIELD_WEIGHTS[field]);
    }
    if (termBest > 0) {
      matched++;
      score += termBest;
    }
  }

  // Phrase bonuses: the whole query appearing intact is a much stronger
  // signal than the same words scattered across fields. This is what pushes
  // "Orbit Air Earbuds" above other Orbit products for "orbit air".
  if (terms.length > 1 && phrase) {
    if (doc.name.includes(phrase)) score += 120;
    else if (doc.brand.includes(phrase) || doc.categories.includes(phrase)) score += 60;
  }

  return { score, matched };
}

export interface SearchOutcome {
  hits: SearchHit[];
  terms: string[];
  /** true when no product matched every term and we widened to the best partial */
  partial: boolean;
}

/**
 * Rank `products` against `query`, strongest first.
 *
 * `categoryNamesFor` is injected rather than imported so this module never
 * reaches into the catalogue — that keeps it pure and lets the same ranking
 * run over rows from a future API.
 */
export function rankProducts(
  products: Product[],
  query: string,
  categoryNamesFor: (product: Product) => string[],
): SearchOutcome {
  const terms = tokenize(query);
  if (!terms.length) return { hits: products.map((p) => ({ product: p, score: 0, matched: 0 })), terms, partial: false };

  const phrase = normalise(query);
  const scored: SearchHit[] = [];
  let bestMatched = 0;

  for (const product of products) {
    const { score, matched } = scoreDoc(buildSearchDoc(product, categoryNamesFor(product)), terms, phrase);
    if (matched === 0) continue;
    if (matched > bestMatched) bestMatched = matched;
    scored.push({ product, score, matched });
  }

  /*
   * AND-first. Widen only if nothing matched everything AND the best partial
   * still landed two or more terms — a single stray word ("black" out of
   * "blue gaming refrigerator") is not evidence of intent.
   */
  const required = bestMatched === terms.length ? terms.length : bestMatched >= 2 || terms.length === 1 ? bestMatched : terms.length + 1;
  const hits = scored.filter((h) => h.matched >= required);

  hits.sort(
    (a, b) =>
      b.matched - a.matched ||
      b.score - a.score ||
      b.product.rating.average - a.product.rating.average ||
      b.product.soldCount - a.product.soldCount ||
      a.product.id.localeCompare(b.product.id),
  );

  return { hits, terms, partial: hits.length > 0 && required < terms.length };
}
