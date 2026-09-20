/*
 * Local shopping-intent parser.
 *
 * Turns "a black sneaker for everyday use under 80k" into real constraints
 * the catalogue can answer:  { maxPrice: 8_000_000, categoryPath: [...],
 *                              query: 'black sneaker everyday' }
 *
 * This is NOT a stand-in that fakes an answer — the constraints it extracts
 * are handed straight to `listProducts()` and every product shown comes back
 * from the tenant's catalogue. It is deliberately deterministic so it can be
 * unit-tested and so it costs nothing at request time.
 *
 * When an LLM is wired up (see lib/ai/types.ts) it replaces `parseShoppingIntent`
 * and keeps the same `ShoppingIntent` output, so nothing downstream changes.
 * Keeping this parser as the fallback is worthwhile anyway: it handles the
 * common "<thing> under <price>" phrasing without a network round-trip.
 */
import type { RecognisedConstraint, ShoppingIntent } from './types';
import type { SortKey } from '@/lib/storefront/types';

/** Catalogue nouns the parser can match against. Built server-side from the
 *  tenant's own categories/brands — never a hardcoded list. */
export interface IntentVocabulary {
  categories: { name: string; path: string[] }[];
  brands: { name: string; slug: string }[];
  /** minor units per major unit (100 for kobo/cents) */
  currencyScale: number;
  /** used only to format the recognised-budget chip */
  formatMoney: (minor: number) => string;
}

/* Words that carry no search signal once constraints are lifted out. */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'i', 'me', 'my', 'we', 'need', 'want', 'looking', 'look',
  'for', 'to', 'buy', 'get', 'find', 'show', 'some', 'something', 'any',
  'please', 'help', 'with', 'and', 'or', 'of', 'in', 'on', 'at', 'is', 'it',
  'that', 'this', 'good', 'nice', 'best', 'new', 'use', 'used', 'using',
  'under', 'below', 'over', 'above', 'between', 'around', 'about', 'up',
  'less', 'than', 'max', 'maximum', 'min', 'minimum', 'budget', 'price',
  'cheap', 'cheapest', 'affordable', 'quality', 'top', 'rated', 'please',
]);

/**
 * Parses a money-ish token: "80k", "1.2m", "₦50,000", "50000", "$1,200".
 * Currency symbols are stripped rather than matched, so this works whatever
 * the store trades in. Returns MINOR units, or null.
 */
export function parseAmount(raw: string, scale: number): number | null {
  const cleaned = raw.replace(/[^0-9.kmKM]/g, '');
  const m = cleaned.match(/^(\d+(?:\.\d+)?)([kKmM]?)$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const mult = m[2].toLowerCase() === 'k' ? 1_000 : m[2].toLowerCase() === 'm' ? 1_000_000 : 1;
  return Math.round(n * mult * scale);
}

/* A money token: optional symbol, digits with separators, optional k/m. */
const MONEY = String.raw`[^\s\d]{0,3}\s?\d[\d,.]*\s?[kKmM]?`;

const SORT_HINTS: { re: RegExp; sort: SortKey; label: string }[] = [
  { re: /\b(cheapest|lowest price|least expensive)\b/i, sort: 'price-asc', label: 'Cheapest first' },
  { re: /\b(most expensive|premium|highest price)\b/i, sort: 'price-desc', label: 'Premium first' },
  // "best rating" / "highest rating" are as common as the participle forms,
  // and the assistant offers that exact phrasing as a suggestion chip.
  { re: /\b(best|top|highest) (rated|rating|reviewed|reviews)\b/i, sort: 'rating', label: 'Best rated' },
  { re: /\b(popular|bestselling|best selling|trending)\b/i, sort: 'bestselling', label: 'Most popular' },
  { re: /\b(newest|latest|just landed|new in)\b/i, sort: 'newest', label: 'Newest first' },
];

export function parseShoppingIntent(input: string, vocab: IntentVocabulary): ShoppingIntent {
  const text = input.trim();
  const recognised: RecognisedConstraint[] = [];
  if (!text) return { recognised };

  let rest = ` ${text} `;
  const intent: ShoppingIntent = { recognised };

  /* ── budget ─────────────────────────────────────────────────────────── */
  // "between X and Y" first: its two numbers would otherwise be read as two
  // separate single-bound constraints.
  const between = rest.match(
    new RegExp(String.raw`\b(?:between|from)\s+(${MONEY})\s*(?:and|-|–|to)\s*(${MONEY})`, 'i'),
  );
  if (between) {
    const lo = parseAmount(between[1], vocab.currencyScale);
    const hi = parseAmount(between[2], vocab.currencyScale);
    if (lo && hi) {
      intent.minPrice = Math.min(lo, hi);
      intent.maxPrice = Math.max(lo, hi);
      recognised.push({
        kind: 'budget',
        label: `${vocab.formatMoney(intent.minPrice)} – ${vocab.formatMoney(intent.maxPrice)}`,
      });
      rest = rest.replace(between[0], ' ');
    }
  }

  if (intent.maxPrice == null) {
    const under = rest.match(
      new RegExp(String.raw`\b(?:under|below|less than|up to|max(?:imum)?|within|cheaper than)\s+(${MONEY})`, 'i'),
    );
    if (under) {
      const v = parseAmount(under[1], vocab.currencyScale);
      if (v) {
        intent.maxPrice = v;
        recognised.push({ kind: 'budget', label: `Under ${vocab.formatMoney(v)}` });
        rest = rest.replace(under[0], ' ');
      }
    }
  }

  if (intent.minPrice == null) {
    const over = rest.match(
      new RegExp(String.raw`\b(?:over|above|more than|at least|from)\s+(${MONEY})`, 'i'),
    );
    if (over) {
      const v = parseAmount(over[1], vocab.currencyScale);
      if (v) {
        intent.minPrice = v;
        recognised.push({ kind: 'budget', label: `Over ${vocab.formatMoney(v)}` });
        rest = rest.replace(over[0], ' ');
      }
    }
  }

  /* ── sort hints ─────────────────────────────────────────────────────── */
  for (const hint of SORT_HINTS) {
    const m = rest.match(hint.re);
    if (m) {
      intent.sort = hint.sort;
      recognised.push({ kind: 'sort', label: hint.label });
      rest = rest.replace(m[0], ' ');
      break;
    }
  }

  /* ── brand ──────────────────────────────────────────────────────────── */
  // Longest name first so "Forge & Co." wins over a hypothetical "Forge".
  for (const brand of [...vocab.brands].sort((a, b) => b.name.length - a.name.length)) {
    const re = new RegExp(`\\b${escapeRe(brand.name)}\\b`, 'i');
    if (re.test(rest)) {
      intent.brandSlugs = [brand.slug];
      recognised.push({ kind: 'brand', label: brand.name });
      rest = rest.replace(re, ' ');
      break;
    }
  }

  /* ── category ───────────────────────────────────────────────────────── */
  // Deepest (most specific) match wins: "running shoes" should beat "shoes".
  const catMatch = [...vocab.categories]
    .sort((a, b) => b.path.length - a.path.length || b.name.length - a.name.length)
    .find((c) => matchesCategory(rest, c.name));
  if (catMatch) {
    intent.categoryPath = catMatch.path;
    recognised.push({ kind: 'category', label: catMatch.name });
    rest = rest.replace(new RegExp(escapeRe(singularise(catMatch.name)), 'i'), ' ');
  }

  /* ── leftover keywords ──────────────────────────────────────────────── */
  const keywords = rest
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  if (keywords.length) {
    intent.query = keywords.join(' ');
    recognised.push({ kind: 'keyword', label: keywords.slice(0, 4).join(', ') });
  }

  return intent;
}

/* Matches a category name allowing simple plural/singular drift, so "shoes"
 * finds "Shoe" and "Dress" finds "Dresses". */
function matchesCategory(haystack: string, name: string): boolean {
  const base = singularise(name);
  if (base.length < 3) return false;
  return new RegExp(`\\b${escapeRe(base)}(?:e?s)?\\b`, 'i').test(haystack);
}

function singularise(word: string): string {
  const w = word.trim();
  if (/ies$/i.test(w)) return w.slice(0, -3) + 'y';
  if (/(ches|shes|sses|xes)$/i.test(w)) return w.slice(0, -2);
  if (/s$/i.test(w) && !/ss$/i.test(w)) return w.slice(0, -1);
  return w;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
