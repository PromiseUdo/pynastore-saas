/*
 * lib/ai/social/validate.ts
 *
 * What the model wrote, checked against what is actually true.
 *
 * The prompt tells Gemini not to invent prices, discounts, specifications,
 * stock, materials, shipping promises, warranties or features. A prompt is
 * an instruction, not a guarantee — this file is the guarantee. Output goes
 * through here before a merchant ever sees it, and anything that claims
 * something the product's own rows don't support is removed.
 *
 * Deliberately removes the offending SENTENCE rather than rejecting the
 * whole caption: a merchant pressing Generate wants copy, and a draft
 * missing one invented line is more useful than an error. Whatever survives
 * is still fully editable, and nothing publishes without the merchant
 * pressing Publish themselves.
 *
 * This is a safety net, not a truth oracle. It cannot catch every possible
 * fabrication — it catches the specific, checkable categories the product
 * brief names, which are the ones that get a merchant in trouble with a
 * customer or a regulator.
 */
import type { ProductFacts } from '@/lib/social/product-facts';

/** What was dropped and why, so the UI can be honest about it. */
export interface CaptionCheck {
  text: string;
  /** Plain-language notes about anything removed. Empty when nothing was. */
  removed: string[];
}

/* Money in any of the forms a model writes it: ₦12,000 · NGN 12000 · $30. */
const MONEY = /(?:₦|NGN\s*|\$|USD\s*|£|GBP\s*|€|EUR\s*)\s?\d[\d,.]*/gi;

/* Claims about getting it to you, or what happens if it breaks. */
const SHIPPING = /\b(free (?:delivery|shipping)|next[- ]day|same[- ]day|ships? (?:within|in)|delivered? (?:within|in)|\d+[-–]\d+ (?:day|week)s? delivery|worldwide shipping)\b/i;
const WARRANTY = /\b(warrant(?:y|ies)|guarantee[ds]?|money[- ]back|refundable|lifetime)\b/i;

/* Urgency and scarcity — a stock claim by another name. */
const STOCK = /\b(in stock|out of stock|only \d+ left|last \w+ (?:remaining|left)|selling fast|limited stock|while stocks last|hurry)\b/i;

/* Price cuts nobody recorded. */
const DISCOUNT = /\b(\d+% off|discount|sale price|reduced|slashed|was \S+ now|bargain price|clearance)\b/i;

/** Splits into sentences while keeping their punctuation and line breaks. */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).filter((part) => part.trim().length > 0);
}

/**
 * Every money string the facts genuinely support, normalised for comparison.
 * A caption may repeat the real price; it may not invent a different one.
 */
function allowedMoney(facts: ProductFacts): Set<string> {
  const allowed = new Set<string>();
  const harvest = (value: string | null) => {
    for (const match of value?.match(MONEY) ?? []) allowed.add(normaliseMoney(match));
  };
  harvest(facts.priceLabel);
  /* Merchant-written text is the merchant's own claim — if their description
   * or specs quote a figure, the caption may too. */
  harvest(facts.description);
  harvest(facts.shortDescription);
  for (const line of [...facts.specs, ...facts.highlights]) harvest(line);
  return allowed;
}

/**
 * Reduces a money string to its bare amount, so the same price written
 * differently still compares equal: "₦24,500", "NGN 24500.00" and "₦24,500."
 * at the end of a sentence are all `24500`.
 *
 * The currency symbol is deliberately dropped. Comparing amounts alone is
 * the stricter, simpler rule — a model that writes the right number in the
 * wrong currency still trips the shipping/discount checks, and a merchant
 * whose price is ₦24,500 has no legitimate "$24,500" to protect.
 */
function normaliseMoney(value: string): string {
  const digits = value
    .replace(/[^\d.,]/g, '')
    // Trailing sentence punctuation is not part of the number.
    .replace(/[.,]+$/, '')
    // Thousands separators, wherever they fall.
    .replace(/,(?=\d{3}\b)/g, '');

  const amount = Number.parseFloat(digits.replace(/,/g, ''));
  return Number.isFinite(amount) ? String(amount) : digits;
}

/** True when the facts say anything at all about delivery/returns/warranty. */
function factsMention(facts: ProductFacts, pattern: RegExp): boolean {
  const corpus = [facts.description, facts.shortDescription, ...facts.specs, ...facts.highlights]
    .filter(Boolean)
    .join(' ');
  return pattern.test(corpus);
}

/**
 * Strips sentences that claim something the product's rows don't support.
 *
 * `facts` is the same ProductFacts the model was given, so "supported" means
 * exactly "present in what we told it" — there is no second source.
 */
export function stripUnsupportedClaims(text: string, facts: ProductFacts): CaptionCheck {
  const allowed = allowedMoney(facts);
  const removed: string[] = [];
  const kept: string[] = [];

  for (const sentence of sentences(text)) {
    /* A price we never quoted. The merchant's real price is in the facts, so
     * anything else is the model guessing at what a thing costs. */
    const money = sentence.match(MONEY) ?? [];
    if (money.some((value) => !allowed.has(normaliseMoney(value)))) {
      removed.push('a price we haven’t recorded for this product');
      continue;
    }

    if (DISCOUNT.test(sentence)) {
      removed.push('a discount or sale claim');
      continue;
    }

    if (STOCK.test(sentence)) {
      removed.push('a stock or urgency claim');
      continue;
    }

    if (SHIPPING.test(sentence) && !factsMention(facts, SHIPPING)) {
      removed.push('a delivery promise the product doesn’t state');
      continue;
    }

    if (WARRANTY.test(sentence) && !factsMention(facts, WARRANTY)) {
      removed.push('a warranty or guarantee the product doesn’t state');
      continue;
    }

    kept.push(sentence);
  }

  return {
    text: kept.join(' ').replace(/\s{2,}/g, ' ').trim(),
    // Each reason once, however many sentences triggered it.
    removed: [...new Set(removed)],
  };
}

/**
 * Cleans one hashtag, or rejects it.
 *
 * Rules, in order: it must be a hashtag; punctuation and spaces come out;
 * it must have letters (a tag of digits is noise); and it must be a
 * plausible length. Anything that survives is safe to show.
 */
export function cleanHashtag(raw: string): string | null {
  const stripped = raw.trim().replace(/^#+/, '');
  // Unicode letters and numbers only — emoji and punctuation don't belong.
  const cleaned = stripped.replace(/[^\p{L}\p{N}_]/gu, '');

  if (cleaned.length < 2 || cleaned.length > 30) return null;
  if (!/\p{L}/u.test(cleaned)) return null;

  return `#${cleaned}`;
}

/*
 * Tags that are either spam or a promise. `follow4follow` and friends get an
 * account throttled; the rest are claims we've just spent this file
 * removing from captions, and they don't get back in through a hashtag.
 */
const BANNED_HASHTAGS = new Set([
  'follow4follow', 'followforfollow', 'f4f', 'l4l', 'like4like', 'likeforlike',
  'followme', 'follow', 'spam', 'tags4likes', 'instagood', 'instadaily',
  'photooftheday', 'picoftheday', 'love', 'viral', 'explore', 'explorepage',
  'fyp', 'foryou', 'foryoupage', 'trending', 'likes', 'followers',
  'sale', 'discount', 'cheap', 'freeshipping', 'freedelivery', 'giveaway',
  'bestprice', 'lowestprice', 'clearance',
]);

/**
 * Cleans, de-duplicates and caps a list of hashtags.
 *
 * The cap defaults to Instagram's documented limit of 30 per post. Order is
 * kept: the model puts its most relevant tags first.
 */
export function cleanHashtags(raw: string[], max = 30): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const candidate of raw) {
    const tag = cleanHashtag(candidate);
    if (!tag) continue;

    const key = tag.slice(1).toLowerCase();
    if (seen.has(key) || BANNED_HASHTAGS.has(key)) continue;

    seen.add(key);
    out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Removes links the model wasn't given.
 *
 * The only URL a caption may contain is the product's own storefront link,
 * built server-side in lib/social/product-facts.ts. Anything else — a
 * hallucinated shop, a competitor, a tracking link — comes out.
 */
export function stripForeignLinks(text: string, productUrl: string | null): string {
  return text
    .replace(/https?:\/\/\S+|\bwww\.\S+/gi, (match) =>
      productUrl && match.replace(/[.,;:)\]]+$/, '') === productUrl ? match : '',
    )
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
