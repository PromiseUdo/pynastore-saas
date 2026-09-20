/*
 * MockAIShoppingProvider — the assistant, without a model.
 *
 * It is "mock" in exactly one respect: the WORDING is composed by template
 * rather than generated. Everything the wording is about is real — every
 * product, price, rating, spec and policy in a response came back from
 * ./tools.ts, which reads the tenant's catalogue through
 * lib/storefront/catalog.ts.
 *
 * That split is the point of the phase. The expensive, risky half of an AI
 * shopping assistant is the retrieval, the grounding rules, the tenant
 * scoping and the UX; those are built and tested here. Swapping in an LLM
 * replaces `composeX()` with generated prose over the SAME tool results, and
 * nothing above this file changes (§34).
 *
 * Rules this provider keeps, and a real one must too:
 *   • no product, price, stock figure, rating or spec that isn't in a row
 *   • no claim of fit, durability or superiority — attribute, don't assert
 *   • "I don't have enough information" is a valid, frequent answer
 *   • only ever the store named in the request's own StoreScope
 */
import { formatMoney } from '@/lib/storefront/format';
import { buildIntentVocabulary } from '@/lib/storefront/discovery';
import { VISUAL_SEARCH_PATH } from '@/lib/storefront/visual-search/query';
import { categoryHref } from '@/lib/storefront/navigation';
import type { Product } from '@/lib/storefront/types';
import type { IntentVocabulary } from '../intent';
import { intentToQuery } from '../types';
import { answerProductQuestion, NOT_ENOUGH_INFORMATION } from './answers';
import { classifyMessage } from './classify';
import { createShoppingTools, type ShoppingTools } from './tools';
import {
  ASSISTANT_EVENTS,
  MAX_PRODUCTS_PER_ANSWER,
  type AIShoppingProvider,
  type AssistantAction,
  type AssistantComparison,
  type AssistantIntent,
  type AssistantRequest,
  type AssistantResponse,
  type ComparisonRow,
} from './types';

export const OUT_OF_SCOPE_MESSAGE =
  'I’m here to help you shop this store. Ask me about products, prices, features, or what might work for you.';

export const NO_STORE_INFORMATION = 'I don’t have that store information yet.';

export function createMockShoppingProvider(): AIShoppingProvider {
  return {
    id: 'mock',
    ask: async (request) => {
      const turn = await loadTurn(request);
      return respond(turn, classifyTurn(turn));
    },
  };
}

/**
 * Everything one turn needs, read through the tenant-scoped tools.
 *
 * Exported so a model-backed provider (./gemini-provider.ts) can reuse the
 * same grounded retrieval: the model replaces how the message is UNDERSTOOD,
 * never where the products come from.
 */
export interface Turn {
  tools: ShoppingTools;
  currency: string;
  vocab: IntentVocabulary;
  contextProduct: Product | null;
  lastProducts: Product[];
  message: string;
  previousUserMessages: string[];
}

export async function loadTurn(request: AssistantRequest): Promise<Turn> {
  const { message, context, history } = request;
  const tools = createShoppingTools(context.store);
  const currency = await tools.getCurrency();
  const vocab = await buildIntentVocabulary(currency, context.store);

  /* Context is ids only; the rows are re-read here, through the tenant's
   * own catalogue. An id belonging to another store resolves to nothing. */
  const [contextProduct, lastProducts] = await Promise.all([
    context.productId ? tools.getProduct({ productId: context.productId }) : null,
    context.lastProductIds?.length
      ? tools.getProducts(context.lastProductIds.slice(0, MAX_PRODUCTS_PER_ANSWER))
      : [],
  ]);

  return {
    tools,
    currency,
    vocab,
    contextProduct,
    lastProducts,
    message,
    previousUserMessages: history.filter((t) => t.role === 'user').map((t) => t.text),
  };
}

/** The deterministic understanding of a turn — also every provider's fallback. */
export function classifyTurn(turn: Turn): AssistantIntent {
  return classifyMessage(turn.message, {
    vocab: turn.vocab,
    hasContextProduct: Boolean(turn.contextProduct),
    hasLastProducts: turn.lastProducts.length > 0,
    previousUserMessages: turn.previousUserMessages,
  });
}

/**
 * Carry out an intent against the catalogue. Whoever produced the intent —
 * the classifier or a model — every product in the answer comes from here.
 */
export async function respond(turn: Turn, intent: AssistantIntent): Promise<AssistantResponse> {
  const { tools, currency, contextProduct, lastProducts, message } = turn;
  const env = { tools, currency, intent, contextProduct, lastProducts, message };

  switch (intent.task) {
    case 'greeting':
      return greeting(env);
    case 'out_of_scope':
      return base(intent, currency, { kind: 'out_of_scope', message: OUT_OF_SCOPE_MESSAGE });
    case 'policy':
      return policy(env);
    case 'cheaper':
      return alternatives(env, 'cheaper');
    case 'premium':
      return alternatives(env, 'premium');
    case 'similar':
      return alternatives(env, 'similar');
    case 'compare':
      return compare(env);
    case 'rank':
      return rank(env);
    case 'product_question':
      return productQuestion(env);
    default:
      return search(env);
  }
}

/* ─────────────────────────── shared shapes ──────────────────────────── */

interface Env {
  tools: ShoppingTools;
  currency: string;
  intent: AssistantIntent;
  contextProduct: Product | null;
  lastProducts: Product[];
  message: string;
}

function base(
  intent: AssistantIntent,
  currency: string,
  partial: Partial<AssistantResponse> & { kind: AssistantResponse['kind']; message: string },
): AssistantResponse {
  return {
    products: [],
    reasons: {},
    suggestions: [],
    actions: [],
    intent,
    currency,
    ...partial,
  };
}

/** A compact, checkable line under each recommendation — nothing but row fields. */
function reasonFor(product: Product, currency: string): string {
  const parts = [formatMoney(product.priceFrom, currency)];
  if (product.rating.count > 0) {
    parts.push(`rated ${product.rating.average.toFixed(1)}/5 from ${product.rating.count}`);
  }
  if (product.compareAtPrice && product.compareAtPrice > product.priceFrom) {
    parts.push(`down from ${formatMoney(product.compareAtPrice, currency)}`);
  }
  if (!product.inStock) parts.push('out of stock');
  return parts.join(' · ');
}

function reasonsFor(products: Product[], currency: string): Record<string, string> {
  return Object.fromEntries(products.map((p) => [p.id, reasonFor(p, currency)]));
}

/** `/search?…` for the query that produced these results (§15 navigation only). */
function searchHref(intent: AssistantIntent): string {
  const params = new URLSearchParams();
  const { query, minPrice, maxPrice, brandSlugs, sort, minRating } = intent.filters;
  if (query) params.set('q', query);
  if (minPrice != null) params.set('minPrice', String(minPrice / 100));
  if (maxPrice != null) params.set('maxPrice', String(maxPrice / 100));
  for (const slug of brandSlugs ?? []) params.append('brand', slug);
  if (minRating != null) params.set('rating', String(minRating));
  if (sort) params.set('sort', sort);

  const path = intent.filters.categoryPath?.length
    ? categoryHref(intent.filters.categoryPath)
    : '/search';
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/* ──────────────────────────── greeting ──────────────────────────────── */

async function greeting(env: Env): Promise<AssistantResponse> {
  const { tools, currency, intent, contextProduct } = env;

  if (contextProduct) {
    return base(intent, currency, {
      kind: 'text',
      message: `Ask me anything about the ${contextProduct.name} — sizing, materials, what customers said, or how it compares to similar products.`,
      suggestions: [
        'Is this worth the price?',
        'What are the sizing options?',
        'Are there cheaper alternatives?',
        'Compare with similar products',
      ],
    });
  }

  /* Openers built from departments that genuinely have stock. */
  const categories = await tools.getCategories();
  const biggest = [...categories].sort((a, b) => b.productCount - a.productCount).slice(0, 3);

  return base(intent, currency, {
    kind: 'text',
    message:
      'Tell me what you’re after — what it’s for, roughly what you want to spend — and I’ll search the store for it.',
    suggestions: [
      ...biggest.map((c) => `Show me ${c.name.toLowerCase()}`),
      'Show me popular products',
    ].slice(0, 4),
  });
}

/* ──────────────────────────── plain search ──────────────────────────── */

async function search(env: Env): Promise<AssistantResponse> {
  const { tools, currency, intent } = env;
  const query = intentToQuery(intent.filters);

  const result = await tools.searchProducts({
    query: query.query,
    categoryPath: query.categoryPath,
    brandSlugs: query.brandSlugs,
    minPrice: query.minPrice,
    maxPrice: query.maxPrice,
    minRating: query.minRating,
    optionValueIds: query.optionValueIds,
    sort: query.sort,
    limit: MAX_PRODUCTS_PER_ANSWER,
  });

  if (result.total === 0) return noMatch(env);

  const constraints = intent.filters.recognised.map((r) => r.label);
  const opening =
    intent.task === 'refine'
      ? `Narrowing that down — ${result.total} ${plural(result.total, 'match', 'matches')}`
      : `I found ${result.total} ${plural(result.total, 'option', 'options')} in the store`;
  const recap = constraints.length ? ` for ${constraints.join(', ').toLowerCase()}` : '';

  return base(intent, currency, {
    kind: 'products',
    message: `${opening}${recap}. Here ${plural(
      Math.min(result.total, result.items.length),
      'is the closest one',
      'are the closest ones',
    )}.`,
    products: result.items,
    reasons: reasonsFor(result.items, currency),
    total: result.total,
    suggestions: await refinements(env, result.items),
    actions: [
      {
        id: 'see-all',
        label: `See all ${result.total} results`,
        kind: 'navigate',
        href: searchHref(intent),
        event: ASSISTANT_EVENTS.filterRefined,
      },
    ],
  });
}

/**
 * Refinements offered only when they'd genuinely change the results: a brand
 * chip appears when more than one brand came back, a budget chip when the
 * prices actually spread. Suggesting "only Nike" on a page where everything
 * is Nike is noise.
 */
async function refinements(env: Env, items: Product[]): Promise<string[]> {
  const { currency, intent } = env;
  const out: string[] = [];

  const brands = [...new Set(items.map((p) => p.brandName))];
  if (brands.length > 1) out.push(`Only ${brands[0]}`);

  const prices = items.map((p) => p.priceFrom);
  if (intent.filters.maxPrice == null && Math.min(...prices) < Math.max(...prices)) {
    out.push(`Under ${formatMoney(roundUpNicely(median(prices)), currency)}`);
  }

  out.push('Show me something cheaper');
  if (!intent.filters.sort) out.push('Which has the best rating?');

  return out.slice(0, 4);
}

/* ───────────────────────────── no match ─────────────────────────────── */

/**
 * Never a dead end (§30).
 *
 * Each recovery is CHECKED against the catalogue before it is offered, and
 * the numbers quoted ("the cheapest is ₦x") come from that check — so the
 * assistant can't invite a shopper to widen their budget to a band that is
 * also empty.
 */
async function noMatch(env: Env): Promise<AssistantResponse> {
  const { tools, currency, intent } = env;
  const query = intentToQuery(intent.filters);
  const subject = intent.filters.recognised.find((r) => r.kind === 'category')?.label;

  /*
   * 1. Drop the leftover words. "a laptop for programming under ₦1.2m" fails
   *    on "programming" — no laptop's copy contains it — while the real
   *    constraints (laptops, under ₦1.2m) match plenty.
   */
  const hasStructure =
    Boolean(query.categoryPath?.length || query.brandSlugs?.length) ||
    query.minPrice != null ||
    query.maxPrice != null;

  if (query.query && hasStructure) {
    const widened = await tools.searchProducts({ ...query, query: undefined, limit: MAX_PRODUCTS_PER_ANSWER });
    if (widened.total > 0) {
      return base(intent, currency, {
        kind: 'products',
        message: `Nothing in the store is described with all of that, so I searched on the rest of it instead — ${widened.total} ${plural(
          widened.total,
          'match',
          'matches',
        )}.`,
        products: widened.items,
        reasons: reasonsFor(widened.items, currency),
        total: widened.total,
        suggestions: await refinements(env, widened.items),
      });
    }
  }

  /* 2. The budget is the binding constraint — say what it would take. */
  if (query.maxPrice != null) {
    const withoutBudget = await tools.searchProducts({
      ...query,
      minPrice: undefined,
      maxPrice: undefined,
      limit: MAX_PRODUCTS_PER_ANSWER,
    });
    if (withoutBudget.total > 0 && withoutBudget.lowestPrice != null) {
      const lowest = withoutBudget.lowestPrice;
      return base(intent, currency, {
        kind: 'no_match',
        message: `I couldn’t find anything matching that under ${formatMoney(
          query.maxPrice,
          currency,
        )}. The lowest-priced ${subject?.toLowerCase() ?? 'match'} in the store is ${formatMoney(
          lowest,
          currency,
        )} — want me to show you options from there?`,
        suggestions: [`Show me options under ${formatMoney(roundUpNicely(lowest), currency)}`],
        actions: [
          {
            id: 'raise-budget',
            label: `Show options from ${formatMoney(lowest, currency)}`,
            kind: 'ask',
            message: `Show me ${subject?.toLowerCase() ?? 'options'} under ${formatMoney(
              roundUpNicely(lowest),
              currency,
            )}`,
            event: ASSISTANT_EVENTS.filterRefined,
          },
        ],
      });
    }
  }

  /* 3. Nothing of that kind here at all — offer departments that do exist. */
  const categories = await tools.getCategories();
  const biggest = [...categories].sort((a, b) => b.productCount - a.productCount).slice(0, 3);

  return base(intent, currency, {
    kind: 'no_match',
    message:
      'I couldn’t find an exact match for that in this store. I can broaden the search, or point you at a department that does have stock — and if you have a picture of it, searching by image often works when words don’t.',
    suggestions: biggest.map((c) => `Show me ${c.name.toLowerCase()}`),
    actions: [
      ...biggest.map((c) => ({
        id: `browse-${c.path.join('-')}`,
        label: `Browse ${c.name}`,
        kind: 'navigate' as const,
        href: categoryHref(c.path),
      })),
      /* The assistant points at visual search; it does not perform it. The
       * two stay separate discovery workflows (§22). */
      {
        id: 'search-by-image',
        label: 'Search with a photo',
        kind: 'navigate' as const,
        href: VISUAL_SEARCH_PATH,
      },
    ],
  });
}

/* ─────────────────── cheaper / premium / similar ────────────────────── */

const ALTERNATIVE_COPY = {
  cheaper: {
    lead: (name: string, n: number) =>
      `${n} related ${plural(n, 'product', 'products')} that cost less than the ${name}`,
    none: (name: string) =>
      `Nothing related to the ${name} in this store is listed at a meaningfully lower price.`,
    event: ASSISTANT_EVENTS.alternativeRequested,
  },
  premium: {
    lead: (name: string, n: number) =>
      `${n} related ${plural(n, 'product', 'products')} that cost more than the ${name} and are rated higher or sell harder`,
    none: (name: string) =>
      `I couldn’t find a related product that costs more than the ${name} AND is better rated or better selling — so I’d rather not call anything an upgrade.`,
    event: ASSISTANT_EVENTS.alternativeRequested,
  },
  similar: {
    lead: (name: string, n: number) =>
      `${n} ${plural(n, 'product', 'products')} from the same part of the store as the ${name}`,
    none: (name: string) => `I couldn’t find anything closely comparable to the ${name} here.`,
    event: ASSISTANT_EVENTS.productRecommended,
  },
} as const;

async function alternatives(
  env: Env,
  kind: 'cheaper' | 'premium' | 'similar',
): Promise<AssistantResponse> {
  const { tools, currency, intent } = env;
  const subject = env.contextProduct ?? env.lastProducts[0] ?? null;

  if (!subject) {
    return base(intent, currency, {
      kind: 'follow_up',
      message: 'Which product should I compare against? Open one, or tell me what you’re looking for and I’ll find some first.',
      followUp: {
        question: 'What are you shopping for?',
        options: ['Show me popular products', 'Show me what’s on sale'],
      },
    });
  }

  const copy = ALTERNATIVE_COPY[kind];
  const products =
    kind === 'cheaper'
      ? await tools.findCheaperAlternatives({ productId: subject.id, limit: MAX_PRODUCTS_PER_ANSWER })
      : kind === 'premium'
        ? await tools.findPremiumAlternatives({ productId: subject.id, limit: MAX_PRODUCTS_PER_ANSWER })
        : await tools.findSimilarProducts({ productId: subject.id, limit: MAX_PRODUCTS_PER_ANSWER });

  if (!products.length) {
    return base(intent, currency, {
      kind: 'no_match',
      message: copy.none(subject.name),
      suggestions: kind === 'cheaper' ? ['Show me similar products'] : ['Show me something cheaper'],
    });
  }

  const saving =
    kind === 'cheaper'
      ? ` The closest one is ${formatMoney(
          subject.priceFrom - Math.max(...products.map((p) => p.priceFrom)),
          currency,
        )} less than the ${formatMoney(subject.priceFrom, currency)} you’re looking at.`
      : '';

  return base(intent, currency, {
    kind: 'products',
    message: `Here ${plural(products.length, 'is', 'are')} ${copy.lead(subject.name, products.length)}.${saving}`,
    products,
    reasons: reasonsFor(products, currency),
    total: products.length,
    suggestions: [
      kind === 'cheaper' ? 'Show me something more premium' : 'Show me something cheaper',
      'Which has the best rating?',
      `Compare with the ${subject.name}`,
    ],
    actions: [
      {
        id: 'view-subject',
        label: `Back to the ${subject.name}`,
        kind: 'navigate',
        href: `/products/${subject.slug}`,
        event: copy.event,
      },
    ],
  });
}

/* ───────────────────────────── comparison ───────────────────────────── */

async function compare(env: Env): Promise<AssistantResponse> {
  const { tools, currency, intent } = env;
  const subject = env.contextProduct ?? env.lastProducts[0] ?? null;

  let others: Product[] = [];
  if (intent.namedProduct) {
    /* The named product is LOOKED UP, never assumed to exist. */
    const found = await tools.searchProducts({ query: intent.namedProduct, limit: 2 });
    others = found.items.filter((p) => p.id !== subject?.id).slice(0, 1);
    if (!others.length) {
      return base(intent, currency, {
        kind: 'no_match',
        message: `I couldn’t find “${intent.namedProduct}” in this store, so I can’t compare against it. If you tell me which product you mean I’ll line them up.`,
        suggestions: subject ? ['Show me similar products'] : [],
      });
    }
  } else {
    others = env.lastProducts.filter((p) => p.id !== subject?.id).slice(0, 2);
  }

  const products = [subject, ...others].filter((p): p is Product => Boolean(p));
  if (products.length < 2) {
    return base(intent, currency, {
      kind: 'follow_up',
      message: 'Tell me which two products you’d like compared and I’ll put their listed details side by side.',
      followUp: { question: 'What should I compare?', options: ['Show me similar products'] },
    });
  }

  const comparison = buildComparison(products, currency);

  return base(intent, currency, {
    kind: 'comparison',
    message: comparisonSummary(products, currency),
    products,
    reasons: reasonsFor(products, currency),
    comparison,
    suggestions: ['Which has the best rating?', 'Show me something cheaper'],
  });
}

/**
 * Side-by-side on attributes both rows carry. Specs are included only where
 * every product has that label, because a blank column reads as "this one
 * doesn't have it" when it means "nobody wrote it down".
 */
export function buildComparison(products: Product[], currency: string): AssistantComparison {
  const rows: ComparisonRow[] = [
    { label: 'Price', values: products.map((p) => formatMoney(p.priceFrom, currency)) },
    {
      label: 'Rating',
      values: products.map((p) =>
        p.rating.count ? `${p.rating.average.toFixed(1)}/5 (${p.rating.count})` : 'No reviews yet',
      ),
    },
    { label: 'Brand', values: products.map((p) => p.brandName) },
    { label: 'Availability', values: products.map((p) => (p.inStock ? 'In stock' : 'Out of stock')) },
  ];

  const sharedLabels = products[0].specs
    .map((s) => s.label)
    .filter((label) => products.every((p) => p.specs.some((s) => s.label === label)));

  for (const label of sharedLabels) {
    rows.push({
      label,
      values: products.map((p) => p.specs.find((s) => s.label === label)?.value ?? null),
    });
  }

  return { productIds: products.map((p) => p.id), rows };
}

/**
 * The prose around a comparison.
 *
 * States the differences and stops. No "X is the better buy" — the listing
 * does not contain that fact, and the shopper's priorities aren't ours to
 * assume (§19, §37).
 */
function comparisonSummary(products: Product[], currency: string): string {
  const [a, b] = products;
  const parts: string[] = [];

  if (a.priceFrom !== b.priceFrom) {
    const [cheap, dear] = a.priceFrom < b.priceFrom ? [a, b] : [b, a];
    parts.push(
      `the ${dear.name} costs ${formatMoney(dear.priceFrom - cheap.priceFrom, currency)} more than the ${cheap.name}`,
    );
  } else {
    parts.push(`they're listed at the same price, ${formatMoney(a.priceFrom, currency)}`);
  }

  if (a.rating.count && b.rating.count && a.rating.average !== b.rating.average) {
    const better = a.rating.average > b.rating.average ? a : b;
    parts.push(
      `the ${better.name} is rated higher at ${better.rating.average.toFixed(1)}/5 from ${better.rating.count} reviews`,
    );
  }

  if (a.inStock !== b.inStock) {
    const stocked = a.inStock ? a : b;
    parts.push(`only the ${stocked.name} is in stock`);
  }

  return `Going on what's listed: ${parts.join(', and ')}. The full side-by-side is below — which matters more is your call.`;
}

/* ─────────────────────────────── ranking ────────────────────────────── */

async function rank(env: Env): Promise<AssistantResponse> {
  const { currency, intent, lastProducts } = env;

  if (intent.rankBy === 'price') {
    if (!lastProducts.length) {
      return base(intent, currency, {
        kind: 'follow_up',
        message: 'Which products should I compare on price? Tell me what you’re looking for and I’ll find some first.',
        followUp: { question: 'What are you shopping for?', options: ['Show me popular products'] },
      });
    }
    const ordered = [...lastProducts].sort((a, b) => a.priceFrom - b.priceFrom);
    const [cheapest, next] = ordered;
    const gap =
      next && next.priceFrom > cheapest.priceFrom
        ? ` — ${formatMoney(next.priceFrom - cheapest.priceFrom, currency)} less than the next one, the ${next.name}`
        : '';
    return base(intent, currency, {
      kind: 'comparison',
      message: `Of the ones I showed you, the ${cheapest.name} is the cheapest at ${formatMoney(
        cheapest.priceFrom,
        currency,
      )}${gap}.`,
      products: ordered,
      reasons: reasonsFor(ordered, currency),
      comparison: ordered.length > 1 ? buildComparison(ordered.slice(0, 3), currency) : undefined,
      suggestions: ['Which has the best rating?', `Is the ${cheapest.name} worth the price?`],
      actions: [
        {
          id: 'view-top',
          label: `View the ${cheapest.name}`,
          kind: 'navigate',
          href: `/products/${cheapest.slug}`,
          event: ASSISTANT_EVENTS.productOpened,
        },
      ],
    });
  }

  const rated = lastProducts.filter((p) => p.rating.count > 0);

  if (!rated.length) {
    return base(intent, currency, {
      kind: 'text',
      message: 'None of those have customer reviews yet, so there’s no rating to rank them by.',
      products: lastProducts,
      reasons: reasonsFor(lastProducts, currency),
    });
  }

  const ordered = [...rated].sort(
    (a, b) => b.rating.average - a.rating.average || b.rating.count - a.rating.count,
  );
  const top = ordered[0];

  return base(intent, currency, {
    kind: 'comparison',
    message: `Of the ones I showed you, the ${top.name} has the highest rating — ${top.rating.average.toFixed(
      1,
    )}/5 from ${top.rating.count} ${plural(top.rating.count, 'review', 'reviews')}, at ${formatMoney(
      top.priceFrom,
      currency,
    )}.`,
    products: ordered,
    reasons: reasonsFor(ordered, currency),
    comparison: buildComparison(ordered.slice(0, 3), currency),
    suggestions: ['Show me something cheaper', `Is the ${top.name} worth the price?`],
    actions: [
      {
        id: 'view-top',
        label: `View the ${top.name}`,
        kind: 'navigate',
        href: `/products/${top.slug}`,
        event: ASSISTANT_EVENTS.productOpened,
      },
    ],
  });
}

/* ──────────────────────────── product Q&A ───────────────────────────── */

async function productQuestion(env: Env): Promise<AssistantResponse> {
  const { tools, currency, intent, message } = env;
  const product = env.contextProduct ?? env.lastProducts[0] ?? null;

  if (!product) {
    return base(intent, currency, {
      kind: 'follow_up',
      message: 'Which product are you asking about? Open it and I’ll answer from its listing.',
      followUp: { question: 'What are you looking at?', options: ['Show me popular products'] },
    });
  }

  const [specifications, reviews, policies, category] = await Promise.all([
    tools.getProductSpecifications({ productId: product.id }),
    tools.getProductReviews({ productId: product.id, limit: 2 }),
    tools.getStorePolicies(),
    tools.getProductCategory({ productId: product.id }),
  ]);

  if (!specifications) {
    return base(intent, currency, { kind: 'error', message: NOT_ENOUGH_INFORMATION });
  }

  const answer = answerProductQuestion({
    product,
    topic: intent.topic ?? 'unknown',
    message,
    specifications,
    reviews,
    policies,
    categoryMedianPrice: category?.medianPrice ?? null,
    categoryName: category?.name,
    currency,
  });

  /* When the listing can't answer, offer the things it CAN — never a guess. */
  const suggestions = answer.grounded
    ? ['Are there cheaper alternatives?', 'Compare with similar products', 'What do reviews say?']
    : ['What are the listed specifications?', 'What do reviews say?', 'Show me similar products'];

  return base(intent, currency, {
    kind: 'text',
    message: answer.body,
    products: [product],
    reasons: { [product.id]: reasonFor(product, currency) },
    suggestions,
  });
}

/* ──────────────────────────── store policy ──────────────────────────── */

async function policy(env: Env): Promise<AssistantResponse> {
  const { tools, currency, intent } = env;
  const policies = await tools.getStorePolicies();
  const topic = intent.topic ?? 'unknown';

  if (topic === 'delivery' && policies.delivery.length) {
    const lines = policies.delivery.map(
      (o) => `${o.label} — ${o.free ? 'free' : formatMoney(o.price, currency)}, ${o.detail}`,
    );
    return base(intent, currency, {
      kind: 'text',
      message: `Delivery options for this store: ${lines.join('; ')}. The exact charge is confirmed at checkout.`,
    });
  }

  if ((topic === 'returns' || topic === 'unknown') && policies.returnWindowDays != null) {
    return base(intent, currency, {
      kind: 'text',
      message: `You can ask to return items within ${policies.returnWindowDays} days of delivery, from your account.${
        policies.pickupAvailable ? ' Pickup from a collection point is also offered.' : ''
      }`,
    });
  }

  if (policies.pickupAvailable != null && /pick ?up|collect/i.test(env.message)) {
    return base(intent, currency, {
      kind: 'text',
      message: policies.pickupAvailable
        ? 'Yes — this store offers collection from a pickup location, selectable at checkout.'
        : 'This store doesn’t offer pickup; orders are delivered.',
    });
  }

  /* Anything the store hasn't configured stays unanswered (§32). */
  return base(intent, currency, { kind: 'text', message: NO_STORE_INFORMATION });
}

/* ───────────────────────────── utilities ───────────────────────────── */

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** 143,720 → 150,000 — the same rounding the price bands use, so a budget
 *  the assistant suggests reads like one a shopper would say out loud. */
function roundUpNicely(minor: number): number {
  const major = minor / 100;
  const magnitude = Math.pow(10, Math.max(0, String(Math.floor(major)).length - 2));
  return Math.max(magnitude, Math.ceil(major / magnitude) * magnitude) * 100;
}
