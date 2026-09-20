/*
 * lib/ai/assistant — the AI Shopping Assistant contract.
 *
 * Phase 9 adds a conversational layer ON TOP of the discovery services that
 * already exist; it does not add a second way to find products. The whole
 * pipeline:
 *
 *   shopper's words
 *        ↓
 *   classifyMessage()        ← ./classify.ts   (deterministic today, LLM later)
 *        ↓  AssistantIntent
 *   ShoppingTools            ← ./tools.ts      (the ONLY door to the catalogue)
 *        ↓  real Product rows
 *   AIShoppingProvider       ← ./mock-provider.ts today
 *        ↓  AssistantResponse
 *   <AssistantPanel>         ← components/storefront/assistant/*
 *        ↓
 *   the SAME <ProductCard> the rest of the storefront uses
 *
 * Two rules the provider — mock or real — may never break:
 *
 *  1. CATALOGUE GROUNDING. Products, prices, stock, ratings, specs, brands,
 *     delivery and policies come from tool results. A provider may choose
 *     between rows and describe them; it may not author them. Everything a
 *     response says about a product must be checkable against the row.
 *  2. TENANT ISOLATION. Tools are constructed from a StoreScope resolved
 *     server-side (see createShoppingTools) and every read goes through
 *     lib/storefront/catalog.ts, which is where the `where: { organizationId }`
 *     lands when the catalogue moves onto Prisma. Nothing in this directory
 *     reaches past that seam, so no provider can see another store's rows.
 */
import type { Product, StoreScope } from '@/lib/storefront/types';
import type { ShoppingIntent } from '../types';

/* ─────────────────────────── shopping intent ─────────────────────────── */

/**
 * What the shopper is trying to do. Not a topic list — a list of things the
 * assistant can actually carry out with the tools it has, which is why there
 * is no `place_order` or `apply_coupon` here (§15: the assistant recommends,
 * it does not transact).
 */
export type ShoppingTask =
  | 'greeting'
  /** find products matching described constraints */
  | 'search'
  /** narrow the previous search rather than start a new one */
  | 'refine'
  | 'similar'
  | 'cheaper'
  | 'premium'
  /** weigh two or more specific products against each other */
  | 'compare'
  /** pick the best-rated / best-selling of what was just shown */
  | 'rank'
  /** a factual question about the product in context */
  | 'product_question'
  /** returns, delivery, pickup — answered only from real store policy data */
  | 'policy'
  /** anything that isn't shopping this store */
  | 'out_of_scope';

/**
 * The subject of a product question, used to decide which fields of the row
 * can answer it. `unknown` is a first-class outcome: it routes to "I don't
 * have enough information to confirm that" rather than to a guess.
 */
export type QuestionTopic =
  | 'sizing'
  | 'material'
  | 'care'
  | 'battery'
  | 'connectivity'
  | 'warranty'
  | 'water'
  | 'suitability'
  | 'value'
  | 'reviews'
  | 'stock'
  | 'colour'
  | 'delivery'
  | 'returns'
  | 'specs'
  | 'unknown';

export interface AssistantIntent {
  task: ShoppingTask;
  /** catalogue constraints lifted out of the text by lib/ai/intent.ts */
  filters: ShoppingIntent;
  topic?: QuestionTopic;
  /** for `rank`: what "best" means — rating (default) or lowest price
   *  ("which of these is cheaper?") */
  rankBy?: 'rating' | 'price';
  /** the shopper said "this"/"it" and there is a product in context */
  referencesContextProduct: boolean;
  /** a product named in the message, for "is this better than the X?" */
  namedProduct?: string;
}

/* ───────────────────────────── conversation ──────────────────────────── */

export interface AssistantTurn {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * What the assistant is allowed to know about where the shopper is.
 *
 * Deliberately small (§10): ids and a query string, never product rows, never
 * customer details. The provider re-reads anything it needs through the
 * tools, which is what keeps the tenant seam in one place.
 */
export interface AssistantContext {
  /** resolved server-side from the request's `org`, never from page state */
  store: StoreScope;
  productId?: string;
  categoryPath?: string[];
  collectionSlug?: string;
  searchQuery?: string;
  /** what is in the bag, as ids only */
  cartProductIds?: string[];
  /** ids the assistant put on screen last turn — what "which one…" refers to */
  lastProductIds?: string[];
}

export interface AssistantRequest {
  message: string;
  context: AssistantContext;
  /** prior turns, oldest first. Capped by the caller — see MAX_HISTORY_TURNS. */
  history: AssistantTurn[];
}

/** Short-term only (§24/§36): enough to resolve "under ₦80k" against the
 *  previous "running shoes", not a memory of the shopper. */
export const MAX_HISTORY_TURNS = 8;

/** Never send more than this many rows back for one answer (§36). */
export const MAX_PRODUCTS_PER_ANSWER = 6;

/* ───────────────────────────── the response ──────────────────────────── */

export type AssistantResponseKind =
  | 'text'
  | 'products'
  | 'comparison'
  | 'follow_up'
  | 'no_match'
  | 'out_of_scope'
  | 'error';

/**
 * A button under an answer.
 *
 * `navigate` goes to a real storefront route; `ask` sends `message` back as
 * the shopper's next turn. There is no action kind that mutates anything —
 * no order, no payment, no account change (§15).
 */
export interface AssistantAction {
  id: string;
  label: string;
  kind: 'navigate' | 'ask';
  /** navigate: a storefront-relative path */
  href?: string;
  /** ask: the text to send as the next message */
  message?: string;
  /** analytics name, for when tracking lands (§39) — nothing is emitted now */
  event?: AssistantEvent;
}

/** One attribute compared across the products in a comparison. */
export interface ComparisonRow {
  label: string;
  /** one entry per product, in `productIds` order; null = not listed */
  values: (string | null)[];
}

export interface AssistantComparison {
  productIds: string[];
  rows: ComparisonRow[];
}

export interface AssistantResponse {
  kind: AssistantResponseKind;
  /** the assistant's own words. Contains no product fact not in `products`. */
  message: string;
  /** real catalogue rows — the UI renders these with the storefront's card */
  products: Product[];
  /** why each product is here, keyed by product id; composed from its row */
  reasons: Record<string, string>;
  comparison?: AssistantComparison;
  /** refinements the shopper can tap; each is sent back as a message */
  suggestions: string[];
  /** one guiding question with clickable options (§22) */
  followUp?: { question: string; options: string[] };
  actions: AssistantAction[];
  intent: AssistantIntent;
  /** ISO code for everything priced in this answer */
  currency: string;
  /** how many matched in total, when `products` is a capped page of them */
  total?: number;
}

/* ─────────────────────────── provider contract ───────────────────────── */

/**
 * The seam a real LLM lands behind.
 *
 * One method on purpose. A provider owns wording and which tools to call; it
 * does not own product truth, routing, or the UI. Swapping mock → OpenAI /
 * Claude / Gemini is a new file implementing this and a line in ./service.ts;
 * no component imports a provider or an AI SDK.
 */
export interface AIShoppingProvider {
  readonly id: string;
  ask(request: AssistantRequest): Promise<AssistantResponse>;
}

/* ──────────────────────────── analytics names ────────────────────────── */

/**
 * Names only (§39). Nothing here is emitted — there is no analytics
 * integration in this phase. They exist so the actions that will matter are
 * already named consistently at the points that will fire them.
 */
export const ASSISTANT_EVENTS = {
  queryStarted: 'ai_query_started',
  productRecommended: 'ai_product_recommended',
  productOpened: 'ai_product_opened',
  filterRefined: 'ai_filter_refined',
  alternativeRequested: 'ai_alternative_requested',
  addToCart: 'ai_add_to_cart',
} as const;

export type AssistantEvent = (typeof ASSISTANT_EVENTS)[keyof typeof ASSISTANT_EVENTS];
