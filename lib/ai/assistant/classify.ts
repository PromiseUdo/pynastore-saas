/*
 * Deterministic message classification.
 *
 * Turns "show me something cheaper" into a task the tool layer can carry
 * out, and "a black sneaker under ₦80k" into catalogue constraints — by
 * reusing `parseShoppingIntent` (lib/ai/intent.ts) for the constraints and
 * adding only the verb on top.
 *
 * Pure, synchronous and vocabulary-driven: the categories and brands it
 * matches against are the tenant's own, handed in by the caller, so nothing
 * here is a hardcoded product taxonomy. That also makes it a plain unit under
 * test — see ./classify.test.ts.
 *
 * When a real LLM lands it replaces this function and keeps the output shape,
 * so the provider, the tools and the UI are unchanged (§34). Keeping the
 * deterministic path is worth it regardless: it is the fallback when the
 * model is unreachable, and it costs nothing.
 */
import { parseShoppingIntent, type IntentVocabulary } from '../intent';
import type { ShoppingIntent } from '../types';
import type { AssistantIntent, QuestionTopic, ShoppingTask } from './types';

export interface ClassifyOptions {
  vocab: IntentVocabulary;
  /** the shopper is on a product page (or asked about one earlier) */
  hasContextProduct?: boolean;
  /** the assistant showed products last turn, so "which one…" has a referent */
  hasLastProducts?: boolean;
  /** earlier user turns, oldest first — how "under ₦80k" keeps its subject */
  previousUserMessages?: string[];
}

/* ─────────────────────────── verb patterns ──────────────────────────── */

const GREETING = /^(hi|hey|hello|yo|good (morning|afternoon|evening)|help|start)\b[\s!.]*$/i;

const POLICY = [
  /\breturn (policy|window|it)\b/i,
  /\brefunds?\b/i,
  /\bexchange (policy|it)\b/i,
  /\bhow long (does )?(delivery|shipping|it) (take|takes)\b/i,
  /\bdelivery (time|times|cost|fee|options?)\b/i,
  /\bshipping (cost|fee|time|options?)\b/i,
  /\b(do you|can i) (offer|do|collect|pick ?up)\b/i,
  /\bpick ?up\b/i,
  /\bwarranty (policy|period)\b/i,
];

/* "Is this better than the Nike?" is a comparison, not a request for premium
 * alternatives — so this runs first. */
const COMPARE = [
  /\bcompare\b/i,
  /\bversus\b/i,
  /\s+vs\.?\s+/i,
  /\bwhich (one )?(is|would be) better\b/i,
  /\bbetter than\b/i,
  /\bdifference between\b/i,
];

const RANK = [
  /\bwhich (one )?(has|is)\b.*\b(best|highest|most)\b/i,
  /\bbest (rated|reviewed|rating)\b/i,
  /\bhighest rated\b/i,
  /\bmost popular\b/i,
  /\bbest seller\b/i,
];

/* "Which of these is cheaper?" orders what is on screen; it is not a request
 * for alternatives to one of them. */
const RANK_BY_PRICE =
  /\bwhich (one |of (these|them|those) )?(is|are|one'?s)?\s*(the )?(cheaper|cheapest|least expensive|lowest price)\b/i;

const CHEAPER = [
  /\bcheaper\b/i,
  /\bless expensive\b/i,
  /\blower price\b/i,
  /\bmore affordable\b/i,
  /\bbudget (option|version|friendly)\b/i,
  /\bsomething cheap\b/i,
];

const PREMIUM = [
  /\bmore premium\b/i,
  /\bpremium (option|version|alternative)/i,
  /\bsomething better\b/i,
  /\bstep up\b/i,
  /\bhigher[- ]end\b/i,
  /\bupgrade\b/i,
  /\bnicer\b/i,
  /\bmore expensive\b/i,
  /\btop of the range\b/i,
];

const SIMILAR = [
  /\bsimilar\b/i,
  /\blike (this|that|it)\b/i,
  /\balternatives?\b/i,
  /\bsomething else like\b/i,
];

/** Phrasings that make a sentence a question about the thing in hand. */
const QUESTION_OPENER =
  /^(is|are|does|do|can|could|will|would|what|whats|what's|how|which|has|have|any)\b/i;

/* ───────────────────────── out-of-scope guard ───────────────────────── */

/*
 * The assistant is a shopping assistant for ONE store (§31). Rather than
 * blocklisting the world, a message is only rejected when it BOTH looks like
 * general knowledge AND carries no shopping signal — so "who makes this
 * jacket" and "what is the material" stay in scope.
 */
const GENERAL_KNOWLEDGE = [
  /\bcapital of\b/i,
  /\bwho (is|was|were) (the )?(president|king|queen|prime minister)\b/i,
  /\bwhat year\b/i,
  /\bweather\b/i,
  /\btell me a (joke|story)\b/i,
  /\bwrite (me )?(a|an|some)\b/i,
  /\btranslate\b/i,
  /\bmeaning of life\b/i,
  /\bwho won\b/i,
  /\bhow (do|can) i (code|program|hack)\b/i,
  /\bpopulation of\b/i,
  /\bdefine\b/i,
];

const SHOPPING_SIGNAL =
  /\b(buy|shop|shopping|product|products|price|prices|cost|costs|cheap|cheaper|expensive|budget|size|sizes|fit|colour|color|stock|deliver|delivery|ship|shipping|return|returns|order|cart|bag|brand|brands|rating|rated|review|reviews|warranty|gift|wear|material|waterproof|battery|recommend|suggest|find|show|looking for|need)\b/i;

/* ───────────────────────── question topics ──────────────────────────── */

const TOPICS: { topic: QuestionTopic; re: RegExp }[] = [
  { topic: 'sizing', re: /\b(size|sizes|sizing|fit|fits|true to size|measurement)\b/i },
  { topic: 'colour', re: /\b(colour|color|colours|colors|shade|swatch)\b/i },
  { topic: 'material', re: /\b(material|fabric|composition|made of|leather|cotton|wool)\b/i },
  { topic: 'care', re: /\b(wash|washing|care|clean|cleaning|machine washable|dry)\b/i },
  { topic: 'battery', re: /\b(battery|charge|charging|playtime|runtime)\b/i },
  { topic: 'connectivity', re: /\b(bluetooth|wi-?fi|usb|connect|connectivity|port|ports|nfc)\b/i },
  { topic: 'warranty', re: /\b(warranty|guarantee|guaranteed)\b/i },
  { topic: 'water', re: /\b(waterproof|water[- ]resistant|rain|splash)\b/i },
  { topic: 'stock', re: /\b(in stock|available|availability|sold out|do you have)\b/i },
  { topic: 'reviews', re: /\b(review|reviews|rating|rated|what do people|do people like)\b/i },
  { topic: 'value', re: /\b(worth (it|the price)|good value|value for money|too expensive)\b/i },
  { topic: 'delivery', re: /\b(deliver|delivery|ship|shipping|arrive)\b/i },
  { topic: 'returns', re: /\b(return|returns|refund|exchange)\b/i },
  {
    topic: 'suitability',
    re: /\b(good for|suitable for|use it for|ok for|okay for|can i use|work for|right for)\b/i,
  },
  { topic: 'specs', re: /\b(spec|specs|specification|specifications|details|features)\b/i },
];

export function detectTopic(message: string): QuestionTopic {
  for (const { topic, re } of TOPICS) if (re.test(message)) return topic;
  return 'unknown';
}

/* ───────────────────────────── the classifier ───────────────────────── */

const matchesAny = (patterns: RegExp[], text: string) => patterns.some((re) => re.test(text));

export function classifyMessage(message: string, opts: ClassifyOptions): AssistantIntent {
  const text = message.trim();
  const {
    vocab,
    hasContextProduct = false,
    hasLastProducts = false,
    previousUserMessages = [],
  } = opts;

  const filters = parseShoppingIntent(text, vocab);
  const base = {
    filters,
    referencesContextProduct: hasContextProduct && /\b(this|it|that|these|the one)\b/i.test(text),
  };

  if (!text || GREETING.test(text)) {
    return { ...base, task: 'greeting', referencesContextProduct: false };
  }

  if (matchesAny(GENERAL_KNOWLEDGE, text) && !SHOPPING_SIGNAL.test(text)) {
    return { ...base, task: 'out_of_scope' };
  }

  if (matchesAny(POLICY, text)) {
    return { ...base, task: 'policy', topic: detectTopic(text) };
  }

  if (matchesAny(COMPARE, text)) {
    return { ...base, task: 'compare', namedProduct: extractNamedProduct(text) };
  }

  /* "Which one has the best rating?" only means something when there is a
   * set on screen to rank. Otherwise it is a search sorted by rating, which
   * `parseShoppingIntent` has already picked up as a sort hint. */
  if (RANK_BY_PRICE.test(text) && hasLastProducts) {
    return { ...base, task: 'rank', rankBy: 'price' };
  }

  if (matchesAny(RANK, text)) {
    return hasLastProducts ? { ...base, task: 'rank' } : { ...base, task: 'search' };
  }

  if (matchesAny(CHEAPER, text)) return { ...base, task: 'cheaper' };
  if (matchesAny(PREMIUM, text)) return { ...base, task: 'premium' };
  if (matchesAny(SIMILAR, text)) return { ...base, task: 'similar' };

  const topic = detectTopic(text);
  const isQuestion = QUESTION_OPENER.test(text) || text.endsWith('?');
  if (hasContextProduct && isQuestion && topic !== 'unknown') {
    return { ...base, task: 'product_question', topic };
  }
  /* A question about the product in hand that names no known topic is still
   * a product question — it just has no field behind it, which is exactly
   * the case that must answer "I don't have enough information". */
  if (hasContextProduct && isQuestion && base.referencesContextProduct) {
    return { ...base, task: 'product_question', topic: 'unknown' };
  }

  /*
   * A bare constraint ("under ₦80k", "only Nike") continues the previous
   * search instead of starting an empty one. The subject is recovered by
   * re-parsing the earlier turns rather than trusting anything the client
   * sent back, which is what keeps conversation state cheap and honest.
   */
  const carried = carryForward(filters, previousUserMessages, vocab);
  if (carried) return { ...base, task: 'refine', filters: carried };

  return { ...base, task: 'search' };
}

/**
 * Merge this turn's constraints onto the last turn that had a subject.
 *
 * Returns null when the current message stands on its own — it names a
 * category, a brand or keywords of its own — so an ordinary new search is
 * never quietly narrowed by something the shopper has moved on from.
 */
export function carryForward(
  current: ShoppingIntent,
  previousUserMessages: string[],
  vocab: IntentVocabulary,
): ShoppingIntent | null {
  const standsAlone = Boolean(current.categoryPath?.length || current.query || current.brandSlugs?.length);
  const addsSomething =
    current.minPrice != null ||
    current.maxPrice != null ||
    current.minRating != null ||
    current.sort != null ||
    Boolean(current.brandSlugs?.length);
  if (standsAlone || !addsSomething) return null;

  for (let i = previousUserMessages.length - 1; i >= 0; i--) {
    const previous = parseShoppingIntent(previousUserMessages[i], vocab);
    if (!previous.categoryPath?.length && !previous.query) continue;
    return {
      ...previous,
      ...stripUndefined(current),
      // the recap chips describe the merged query, subject first
      recognised: [...previous.recognised, ...current.recognised],
    };
  }
  return null;
}

function stripUndefined(intent: ShoppingIntent): Partial<ShoppingIntent> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(intent)) {
    if (key === 'recognised' || value === undefined) continue;
    out[key] = value;
  }
  return out as Partial<ShoppingIntent>;
}

/**
 * The other product in "is this better than the Nike Air Max?".
 *
 * Returns the words after the comparison marker; the provider then LOOKS
 * THAT UP in the catalogue. Nothing is assumed to exist because it was
 * typed — an unrecognised name becomes "I couldn't find that one here".
 */
export function extractNamedProduct(text: string): string | undefined {
  const m = text.match(/\b(?:better than|compared to|compare (?:it |this )?(?:to|with)|versus|vs\.?)\s+(.+)$/i);
  const raw = m?.[1] ?? text.match(/\bwhich is better[,:]?\s*(?:this (?:one|product)?\s*or\s*)?(.+)$/i)?.[1];
  if (!raw) return undefined;
  const cleaned = raw
    .replace(/^(the|a|an|that|this|other)\s+/i, '')
    .replace(/[?.!]+$/, '')
    .trim();
  return cleaned.length > 1 ? cleaned : undefined;
}
