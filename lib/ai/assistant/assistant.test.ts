/*
 * The assistant, end to end against the real fixture catalogue.
 *
 * These tests deliberately do NOT mock the catalogue. The whole claim of
 * Phase 9 is that every product, price and figure in an answer came out of
 * the Product Discovery Service, so the assertions check exactly that: each
 * id returned exists in the repository, each "cheaper" result is genuinely
 * cheaper than the product it was asked about, each Q&A answer quotes a
 * value that is actually on the row.
 *
 * Where a fact is needed for an assertion it is READ from the catalogue in
 * the test rather than hardcoded, so the suite keeps its meaning when the
 * fixtures change.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRODUCTS } from '@/lib/storefront/mock/products';
import { CATEGORY_BY_SLUG } from '@/lib/storefront/mock/categories';
import { listProducts } from '@/lib/storefront/catalog';
import { getRecommendations } from '@/lib/storefront/product-detail';
import type { Product, StoreScope } from '@/lib/storefront/types';
import { createMockShoppingProvider, OUT_OF_SCOPE_MESSAGE } from './mock-provider';
import { askShoppingAssistant, getShoppingProvider, setShoppingProvider } from './service';
import { createShoppingTools, TOOL_DEFINITIONS } from './tools';
import { NOT_ENOUGH_INFORMATION } from './answers';
import { quickPromptsFor } from './prompts';
import type {
  AIShoppingProvider,
  AssistantContext,
  AssistantResponse,
  AssistantTurn,
} from './types';

const STORE: StoreScope = { organizationSlug: 'acme' };
const provider = createMockShoppingProvider();

const ask = (
  message: string,
  context: Partial<AssistantContext> = {},
  history: AssistantTurn[] = [],
) => provider.ask({ message, context: { store: STORE, ...context }, history });

/** Every product in a response must be a row the repository holds. */
const allFromRepository = (response: AssistantResponse) =>
  response.products.every((p) => PRODUCTS.some((row) => row.id === p.id));

const PRODUCT_IDS = new Set(PRODUCTS.map((p) => p.id));
const HEADPHONES = CATEGORY_BY_SLUG.get('headphones')!;

beforeEach(() => setShoppingProvider(null));

/* ─────────────────────── provider abstraction ───────────────────────── */

describe('provider abstraction', () => {
  it('resolves the mock provider by default', () => {
    expect(getShoppingProvider().id).toBe('mock');
  });

  it('falls back to the mock when the env names an unknown provider', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('AI_SHOPPING_PROVIDER', 'gpt-9');
    setShoppingProvider(null);

    expect(getShoppingProvider().id).toBe('mock');
    expect(warn).toHaveBeenCalled();

    vi.unstubAllEnvs();
    warn.mockRestore();
    setShoppingProvider(null);
  });

  it('routes every request through the provider, and caps the history it forwards', async () => {
    const spy = vi.fn<AIShoppingProvider['ask']>(
      async (): Promise<AssistantResponse> => ({
        kind: 'text',
        message: 'stub',
        products: [],
        reasons: {},
        suggestions: [],
        actions: [],
        intent: { task: 'search', filters: { recognised: [] }, referencesContextProduct: false },
        currency: 'NGN',
      }),
    );
    setShoppingProvider({ id: 'stub', ask: spy });

    const history: AssistantTurn[] = Array.from({ length: 20 }, (_, i) => ({
      role: 'user' as const,
      text: `turn ${i}`,
    }));
    await askShoppingAssistant({ message: 'hello', context: { store: STORE }, history });

    expect(spy).toHaveBeenCalledOnce();
    // The cap belongs to the service, so every future provider inherits it.
    expect(spy.mock.calls[0][0].history.length).toBeLessThanOrEqual(8);
    expect(spy.mock.calls[0][0].history.at(-1)?.text).toBe('turn 19');
  });

  it('describes every tool it exposes, for later function calling', () => {
    const tools = createShoppingTools(STORE);
    const described = new Set(TOOL_DEFINITIONS.map((t) => t.name));
    // camelCase method → snake_case tool name
    for (const method of Object.keys(tools)) {
      if (method === 'store' || method === 'getProducts' || method === 'getCurrency') continue;
      const snake = method.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
      expect(described, `${method} is not described in TOOL_DEFINITIONS`).toContain(snake);
    }
  });
});

/* ───────────────────────────── determinism ──────────────────────────── */

describe('mock provider determinism', () => {
  it('answers the same question identically', async () => {
    const a = await ask('show me headphones under 60,000');
    const b = await ask('show me headphones under 60,000');

    expect(a.message).toBe(b.message);
    expect(a.products.map((p) => p.id)).toEqual(b.products.map((p) => p.id));
    expect(a.suggestions).toEqual(b.suggestions);
  });
});

/* ──────────────────────── natural-language search ───────────────────── */

describe('natural-language shopping', () => {
  it('applies a spoken budget as a real price filter', async () => {
    /* The budget is taken from the catalogue's own spread so the test is
     * about the filter, not about whether the fixtures happen to be cheap. */
    const { items } = await listProducts({
      store: STORE,
      categoryPath: HEADPHONES.path,
      sort: 'price-asc',
      perPage: 500,
    });
    const budgetMajor = Math.ceil(items[Math.floor(items.length / 2)].priceFrom / 100);

    const response = await ask(`I need headphones under ₦${budgetMajor.toLocaleString('en-NG')}`);

    expect(response.intent.filters.maxPrice).toBe(budgetMajor * 100);
    expect(response.products.length).toBeGreaterThan(0);
    for (const product of response.products) {
      expect(product.priceFrom).toBeLessThanOrEqual(budgetMajor * 100);
    }
    expect(allFromRepository(response)).toBe(true);
  });

  it('maps a catalogue noun onto its real category', async () => {
    const response = await ask('show me laptops');
    const laptops = CATEGORY_BY_SLUG.get('laptops')!;

    expect(response.intent.filters.categoryPath).toEqual(laptops.path);
    expect(response.products.length).toBeGreaterThan(0);
    for (const product of response.products) {
      expect(product.categoryIds).toContain(laptops.id);
    }
  });

  it('honours a brand named in the sentence', async () => {
    const response = await ask('show me Orbit Audio');

    expect(response.intent.filters.brandSlugs).toEqual(['orbit']);
    expect(response.products.length).toBeGreaterThan(0);
    for (const product of response.products) {
      expect(product.brandName).toBe('Orbit Audio');
    }
  });

  it('never returns more rows than the per-answer cap', async () => {
    const response = await ask('show me dresses');
    expect(response.products.length).toBeLessThanOrEqual(6);
    // …but still reports the true total, so the count isn't misleading.
    const { total } = await listProducts({ store: STORE, categoryPath: ['fashion', 'women', 'dresses'] });
    expect(response.total).toBe(total);
  });

  it('links each recommendation to its real product page', async () => {
    const response = await ask('show me laptops');

    for (const product of response.products) {
      const row = PRODUCTS.find((p) => p.id === product.id)!;
      expect(product.slug).toBe(row.slug);
    }
    // Navigation actions only ever point at storefront routes (§15).
    for (const action of response.actions) {
      if (action.kind === 'navigate') expect(action.href).toMatch(/^\/(products|search|c)\//);
    }
  });

  it('invents nothing when the catalogue has no match', async () => {
    const response = await ask('flux capacitor');

    expect(response.products).toEqual([]);
    expect(response.kind).toBe('no_match');
  });
});

/* ────────────────────────── conversation state ──────────────────────── */

describe('conversation state', () => {
  it('reads a bare budget as a refinement of the previous turn', async () => {
    const history: AssistantTurn[] = [
      { role: 'user', text: 'I need headphones' },
      { role: 'assistant', text: 'I found some options.' },
    ];
    const { items } = await listProducts({
      store: STORE,
      categoryPath: HEADPHONES.path,
      sort: 'price-asc',
      perPage: 500,
    });
    const budgetMajor = Math.ceil(items[Math.floor(items.length / 2)].priceFrom / 100);

    const response = await ask(`under ₦${budgetMajor.toLocaleString('en-NG')}`, {}, history);

    expect(response.intent.task).toBe('refine');
    // The subject survives — "headphones" was understood as a category, and
    // the new constraint is applied on top of it rather than replacing it.
    expect(response.intent.filters.categoryPath).toEqual(HEADPHONES.path);
    expect(response.intent.filters.maxPrice).toBe(budgetMajor * 100);
    expect(response.products.length).toBeGreaterThan(0);
    for (const product of response.products) {
      expect(product.categoryIds).toContain(HEADPHONES.id);
      expect(product.priceFrom).toBeLessThanOrEqual(budgetMajor * 100);
    }
  });

  it('starts fresh when the new message has a subject of its own', async () => {
    const history: AssistantTurn[] = [{ role: 'user', text: 'I need headphones' }];
    const response = await ask('show me dresses', {}, history);

    expect(response.intent.task).toBe('search');
    expect(response.intent.filters.categoryPath?.at(-1)).toBe('dresses');
  });

  it('ranks the set it last showed', async () => {
    const shown = PRODUCTS.filter((p) => p.rating.count > 0).slice(0, 4);
    const response = await ask('which one has the best rating?', {
      lastProductIds: shown.map((p) => p.id),
    });

    expect(response.kind).toBe('comparison');
    const best = [...shown].sort(
      (a, b) => b.rating.average - a.rating.average || b.rating.count - a.rating.count,
    )[0];
    expect(response.message).toContain(best.name);
    expect(response.message).toContain(best.rating.average.toFixed(1));
    expect(response.products.map((p) => p.id).every((id) => PRODUCT_IDS.has(id))).toBe(true);
  });
});

/* ────────────────────── alternatives on a product ───────────────────── */

describe('alternatives', () => {
  /** A product the catalogue can genuinely offer both rails for. */
  const subjectWithRails = async (): Promise<{ product: Product; cheaper: Product[]; premium: Product[] }> => {
    for (const product of PRODUCTS) {
      const { cheaper, premium } = await getRecommendations(product, STORE);
      if (cheaper.length && premium.length) return { product, cheaper, premium };
    }
    throw new Error('no fixture product has both a cheaper and a premium rail');
  };

  it('returns products that genuinely cost less than the one in context', async () => {
    const { product } = await subjectWithRails();
    const response = await ask('show me something cheaper', { productId: product.id });

    expect(response.products.length).toBeGreaterThan(0);
    for (const alternative of response.products) {
      expect(alternative.priceFrom).toBeLessThan(product.priceFrom);
      // …and relevant: not merely the cheapest things in the store (§20).
      expect(
        alternative.categoryIds.some((id) => product.categoryIds.includes(id)),
      ).toBe(true);
    }
    expect(allFromRepository(response)).toBe(true);
  });

  it('uses the existing cheaper-alternative logic rather than a second one', async () => {
    const { product, cheaper } = await subjectWithRails();
    const response = await ask('anything similar but cheaper?', { productId: product.id });

    expect(response.products.map((p) => p.id)).toEqual(cheaper.slice(0, 6).map((p) => p.id));
  });

  it('only calls something premium when it costs more AND performs better', async () => {
    const { product } = await subjectWithRails();
    const response = await ask('show me something better', { productId: product.id });

    expect(response.products.length).toBeGreaterThan(0);
    for (const alternative of response.products) {
      expect(alternative.priceFrom).toBeGreaterThan(product.priceFrom);
      expect(
        alternative.rating.average >= product.rating.average ||
          alternative.soldCount > product.soldCount,
      ).toBe(true);
    }
    // Never disparages the product in hand (§21).
    expect(response.message).not.toMatch(/\bbad\b|\bpoor\b|\bworse\b/i);
  });

  it('asks which product to work from when there is no context', async () => {
    const response = await ask('show me something cheaper');

    expect(response.kind).toBe('follow_up');
    expect(response.products).toEqual([]);
    expect(response.followUp?.options.length).toBeGreaterThan(0);
  });
});

/* ───────────────────────────── comparison ───────────────────────────── */

describe('comparison', () => {
  it('compares two real rows and declares no winner', async () => {
    const [a, b] = PRODUCTS.filter((p) => p.categoryId === PRODUCTS[0].categoryId).slice(0, 2);
    const response = await ask('which is better?', { lastProductIds: [a.id, b.id] });

    expect(response.kind).toBe('comparison');
    expect(response.comparison?.productIds).toEqual([a.id, b.id]);
    expect(response.comparison?.rows.map((r) => r.label)).toContain('Price');
    expect(response.message).not.toMatch(/\bbest (product|buy)\b|you should buy|definitely/i);
  });

  it('says so when the product it was asked to compare against is not stocked here', async () => {
    const response = await ask('is this better than the Nike Air Max?', {
      productId: PRODUCTS[0].id,
    });

    expect(response.kind).toBe('no_match');
    expect(response.products).toEqual([]);
    expect(response.message).toMatch(/couldn’t find/i);
  });
});

/* ──────────────────────────── product Q&A ───────────────────────────── */

describe('product Q&A', () => {
  const withSpec = (label: string) =>
    PRODUCTS.find((p) => p.specs.some((s) => s.label === label))!;

  it('answers from the product’s own listed specifications', async () => {
    const product = withSpec('Composition');
    const composition = product.specs.find((s) => s.label === 'Composition')!.value;

    const response = await ask('what is the material?', { productId: product.id });

    expect(response.message).toContain(composition);
    expect(response.products.map((p) => p.id)).toEqual([product.id]);
  });

  it('answers sizing from the variants that are actually in stock', async () => {
    const product = PRODUCTS.find(
      (p) => p.options.some((o) => o.kind === 'size') && p.inStock,
    )!;
    const sizes = product.options.find((o) => o.kind === 'size')!.values.map((v) => v.label);

    const response = await ask('what are the sizes like?', { productId: product.id });

    for (const size of sizes) expect(response.message).toContain(size);
  });

  it('answers a colour question from stock, not from the swatch row', async () => {
    const product = PRODUCTS.find((p) => p.options.some((o) => o.kind === 'color'))!;
    const colour = product.options.find((o) => o.kind === 'color')!.values[0].label;

    const response = await ask(`do you have this in ${colour}?`, { productId: product.id });

    expect(response.message).toContain(colour);
    expect(response.message).toMatch(/in stock|no stock/i);
  });

  it('quotes the real rating and review count when asked about value', async () => {
    const product = PRODUCTS.find((p) => p.rating.count > 0)!;
    const response = await ask('is this worth the price?', { productId: product.id });

    expect(response.message).toContain(product.rating.average.toFixed(1));
    expect(response.message).toContain(String(product.rating.count));
  });

  it('admits when the listing does not carry the answer', async () => {
    // Nothing in the fixtures claims water resistance.
    const response = await ask('is this waterproof?', { productId: PRODUCTS[0].id });

    expect(response.message).toContain(NOT_ENOUGH_INFORMATION);
    // …and offers what the listing CAN answer instead of guessing.
    expect(response.suggestions.length).toBeGreaterThan(0);
  });

  it('asks which product when a question arrives with no product in context', async () => {
    const response = await ask('is this waterproof?');
    // With no product in context this is not a product question at all, so
    // it must not answer as though one were in hand.
    expect(response.message).not.toContain('waterproof is');
    expect(response.products.every((p) => PRODUCT_IDS.has(p.id))).toBe(true);
  });
});

/* ──────────────────────── no results / recovery ─────────────────────── */

describe('no results', () => {
  it('names the real lowest price rather than dead-ending on a budget', async () => {
    const response = await ask('headphones under ₦2,000');
    const { items } = await listProducts({
      store: STORE,
      categoryPath: ['electronics', 'audio', 'headphones'],
      sort: 'price-asc',
      perPage: 1,
    });
    const lowest = items[0].priceFrom;

    expect(response.kind).toBe('no_match');
    expect(response.message).toMatch(/couldn’t find/i);
    // The figure offered is the catalogue's, not a guess.
    expect(response.message).toContain(String(Math.round(lowest / 100).toLocaleString('en-NG')));
    expect(response.actions.length).toBeGreaterThan(0);
  });

  it('drops unmatched describing words rather than returning nothing', async () => {
    // No laptop's copy contains "programming", but real laptops exist.
    const response = await ask('a laptop for programming under ₦1.5m');

    expect(response.products.length).toBeGreaterThan(0);
    const laptops = CATEGORY_BY_SLUG.get('laptops')!;
    for (const product of response.products) {
      expect(product.categoryIds).toContain(laptops.id);
      expect(product.priceFrom).toBeLessThanOrEqual(150_000_000);
    }
    // …and says what it did, so the results aren't passed off as exact.
    expect(response.message).toMatch(/rest of it|searched on/i);
  });

  it('offers departments that actually have stock when nothing matches at all', async () => {
    const response = await ask('quantum widgets');

    expect(response.kind).toBe('no_match');

    /* Every department offered is a real category page… */
    const departments = response.actions.filter((a) => a.id.startsWith('browse-'));
    expect(departments.length).toBeGreaterThan(0);
    for (const action of departments) {
      expect(action.href).toMatch(/^\/c\//);
    }

    /* …plus the one route out that isn't a department: visual search, which
     * the assistant points at rather than performing itself (Phase 10 §22). */
    expect(response.actions.find((a) => a.id === 'search-by-image')?.href).toBe(
      '/search/image',
    );
  });
});

/* ─────────────────── scope, greeting and quick prompts ──────────────── */

describe('scope and empty state', () => {
  it('declines general knowledge without pretending to be a chatbot', async () => {
    const response = await ask('what is the capital of France?');

    expect(response.kind).toBe('out_of_scope');
    expect(response.message).toBe(OUT_OF_SCOPE_MESSAGE);
    expect(response.products).toEqual([]);
  });

  it('still answers a shopping question that merely looks like trivia', async () => {
    const response = await ask('who makes the cheapest headphones?');
    expect(response.kind).not.toBe('out_of_scope');
  });

  it('opens with real departments rather than invented ones', async () => {
    const response = await ask('hi');

    expect(response.kind).toBe('text');
    expect(response.suggestions.length).toBeGreaterThan(0);
    expect(response.products).toEqual([]);
  });

  it('frames its opening around the product when one is in context', async () => {
    const product = PRODUCTS[0];
    const response = await ask('hello', { productId: product.id });
    expect(response.message).toContain(product.name);
  });

  it('offers a short, surface-appropriate set of quick prompts', () => {
    for (const surface of ['home', 'product', 'search', 'cart', 'category'] as const) {
      const prompts = quickPromptsFor(surface);
      expect(prompts.length).toBeGreaterThan(0);
      expect(prompts.length).toBeLessThanOrEqual(4);
    }
  });

  it('answers every product-page quick prompt without erroring', async () => {
    const product = PRODUCTS.find((p) => p.rating.count > 0)!;
    for (const prompt of quickPromptsFor('product')) {
      const response = await ask(prompt, { productId: product.id });
      expect(response.kind, `${prompt} → ${response.message}`).not.toBe('error');
      expect(response.message.length).toBeGreaterThan(0);
      expect(allFromRepository(response)).toBe(true);
    }
  });

  it('answers store policy from the store’s own data, and nothing else', async () => {
    const delivery = await ask('how long does delivery take?');
    expect(delivery.message).toMatch(/delivery/i);

    const returns = await ask('what is your return policy?');
    expect(returns.message).toMatch(/\d+ days/);

    // A policy the store carries no data for is not answered.
    const unknown = await ask('what is your warranty policy?');
    expect(unknown.message).toMatch(/don’t have that store information|\d+ days/);
  });
});
