/*
 * The Gemini provider, with Gemini replaced by a scripted fetch.
 *
 * What is under test is everything around the model: that its output is
 * only ever a set of filters checked against the store's vocabulary, that the
 * products come from the catalogue and nowhere else, that the store comes
 * from the request and nowhere else, and that every failure — no key, a 429,
 * junk JSON, a spent budget — still answers the shopper from the catalogue.
 *
 * No test here reaches the network: `fetch` is stubbed for the whole file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListProductsParams } from '@/lib/storefront/types';

const seen: ListProductsParams[] = [];
vi.mock('@/lib/storefront/catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storefront/catalog')>();
  return {
    ...actual,
    listProducts: (params: ListProductsParams = {}) => {
      seen.push(params);
      return actual.listProducts(params);
    },
  };
});

const { PRODUCTS } = await import('@/lib/storefront/mock/products');
const { CATEGORY_BY_SLUG } = await import('@/lib/storefront/mock/categories');
const { createGeminiShoppingProvider, checkedAnswer } = await import('./gemini-provider');
const { resetModelCoolDown } = await import('./quota');
const { formatMoney } = await import('@/lib/storefront/format');

const SNEAKERS = CATEGORY_BY_SLUG.get('sneakers')!;
const provider = createGeminiShoppingProvider();

let storeCounter = 0;
/* A fresh store per test, so per-store budgets never leak between tests. */
const freshStore = () => ({ organizationSlug: `gemini-test-${++storeCounter}` });

type Scripted = { status?: number; json: unknown };
let script: Scripted[] = [];
const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
  const next = script.shift();
  if (!next) throw new Error('unexpected Gemini call');
  return new Response(JSON.stringify(next.json), {
    status: next.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
});

/** A successful generateContent response whose text is `payload` as JSON. */
const geminiReturns = (payload: unknown): Scripted => ({
  json: { candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] }, finishReason: 'STOP' }] },
});

beforeEach(() => {
  seen.length = 0;
  script = [];
  fetchMock.mockClear();
  resetModelCoolDown();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('GEMINI_API_KEY', 'test-key-not-real');
  vi.stubEnv('GEMINI_MAX_RPM', '10000');
  vi.stubEnv('GEMINI_MAX_RPD', '10000');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const PRODUCT_IDS = new Set(PRODUCTS.map((p) => p.id));

describe('understanding → catalogue', () => {
  it('turns "black sneakers under ₦100,000" into a scoped catalogue query', async () => {
    script.push(
      geminiReturns({
        task: 'search',
        categoryPath: SNEAKERS.path.join('/'),
        maxPrice: 100000,
        options: [{ option: 'colour', value: 'black' }],
        referencesContextProduct: false,
      }),
    );
    const store = freshStore();
    const res = await provider.ask({ message: 'Show me black sneakers under ₦100,000', context: { store }, history: [] });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(res.products.length).toBeGreaterThan(0);
    for (const p of res.products) {
      expect(PRODUCT_IDS.has(p.id)).toBe(true);
      expect(p.categoryIds).toContain(SNEAKERS.id);
      expect(p.priceFrom).toBeLessThanOrEqual(100000 * 100);
    }
    expect(res.intent.filters.optionValueIds?.length).toBeGreaterThan(0);
    // Every catalogue read carried the store from the request.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((p) => p.store?.organizationSlug === store.organizationSlug)).toBe(true);
  });

  it('drops a category, brand or option the store does not have', async () => {
    script.push(
      geminiReturns({
        task: 'search',
        categoryPath: 'made/up/category',
        brandSlug: 'not-a-brand',
        options: [{ option: 'size', value: '999' }],
        query: 'sneaker',
        referencesContextProduct: false,
      }),
    );
    const res = await provider.ask({ message: 'sneakers', context: { store: freshStore() }, history: [] });

    expect(res.intent.filters.categoryPath).toBeUndefined();
    expect(res.intent.filters.brandSlugs).toBeUndefined();
    expect(res.intent.filters.optionValueIds).toBeUndefined();
    expect(res.products.every((p) => PRODUCT_IDS.has(p.id))).toBe(true);
  });

  it('resolves "size 42" against the store’s own size labels', async () => {
    script.push(
      geminiReturns({
        task: 'search',
        categoryPath: SNEAKERS.path.join('/'),
        options: [{ option: 'size', value: '42' }],
        referencesContextProduct: false,
      }),
    );
    const res = await provider.ask({ message: 'sneakers in size 42', context: { store: freshStore() }, history: [] });
    expect(res.intent.filters.recognised.some((r) => r.kind === 'option' && /42/.test(r.label))).toBe(true);
    expect(res.products.length).toBeGreaterThan(0);
  });

  it('ranks what was shown by price for "which of these is cheaper?"', async () => {
    const shown = PRODUCTS.slice(0, 3);
    script.push(geminiReturns({ task: 'rank', rankBy: 'price', referencesContextProduct: false }));
    const res = await provider.ask({
      message: 'Which of these is cheaper?',
      context: { store: freshStore(), lastProductIds: shown.map((p) => p.id) },
      history: [],
    });
    const cheapest = [...shown].sort((a, b) => a.priceFrom - b.priceFrom)[0];
    expect(res.products[0].id).toBe(cheapest.id);
    expect(res.message).toContain(cheapest.name);
  });

  it('never sends the catalogue — only names for context', async () => {
    script.push(geminiReturns({ task: 'greeting', referencesContextProduct: false }));
    await provider.ask({ message: 'hi', context: { store: freshStore() }, history: [] });

    const [url, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    const prompt: string = body.contents[0].parts[0].text;
    // No product descriptions or prices went out for a greeting.
    expect(PRODUCTS.slice(0, 20).some((p) => prompt.includes(p.shortDescription))).toBe(false);
    // The key travels in a header, never the URL.
    expect(String(url)).not.toContain('test-key-not-real');
    expect((init?.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key-not-real');
  });
});

describe('product questions', () => {
  const product = PRODUCTS.find((p) => p.options.some((o) => o.kind === 'size'))!;

  it('uses Gemini’s answer when it only quotes facts from the row', async () => {
    const price = formatMoney(product.priceFrom, product.currency);
    script.push(
      geminiReturns({ task: 'product_question', topic: 'value', referencesContextProduct: true }),
      geminiReturns({ answer: `It's listed at ${price}.` }),
    );
    const res = await provider.ask({
      message: 'Is this good for a wedding?',
      context: { store: freshStore(), productId: product.id },
      history: [],
    });
    expect(res.message).toBe(`It's listed at ${price}.`);
    expect(res.products[0].id).toBe(product.id);
  });

  it('discards an answer that invents a price, keeping the grounded template', async () => {
    script.push(
      geminiReturns({ task: 'product_question', topic: 'value', referencesContextProduct: true }),
      geminiReturns({ answer: 'Great news — it is on sale today for ₦1,234!' }),
    );
    const res = await provider.ask({
      message: 'is this worth it?',
      context: { store: freshStore(), productId: product.id },
      history: [],
    });
    expect(res.message).not.toContain('1,234');
    expect(res.message.length).toBeGreaterThan(0);
  });
});

describe('failure falls back to the catalogue, never to an error', () => {
  it('answers without the model when no key is set', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    const res = await provider.ask({ message: 'show me sneakers', context: { store: freshStore() }, history: [] });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.kind).not.toBe('error');
    expect(res.products.every((p) => PRODUCT_IDS.has(p.id))).toBe(true);
  });

  it('on a 429, answers deterministically and stops calling Gemini for the cool-down', async () => {
    script.push({
      status: 429,
      json: {
        error: {
          code: 429,
          message: 'Resource exhausted',
          details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '30s' }],
        },
      },
    });
    const store = freshStore();
    const first = await provider.ask({ message: 'show me sneakers', context: { store }, history: [] });
    expect(first.products.length).toBeGreaterThan(0);

    const second = await provider.ask({ message: 'show me sneakers', context: { store }, history: [] });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(second.products.length).toBeGreaterThan(0);
  });

  it('falls back when Gemini returns JSON that fails validation', async () => {
    script.push(geminiReturns({ task: 'buy_it_for_me', storeId: 'someone-else' }));
    const res = await provider.ask({ message: 'show me sneakers', context: { store: freshStore() }, history: [] });
    expect(res.intent.task).toBe('search');
    expect(res.products.every((p) => PRODUCT_IDS.has(p.id))).toBe(true);
  });

  it('falls back on a 500', async () => {
    script.push({ status: 500, json: { error: { message: 'internal' } } });
    const res = await provider.ask({ message: 'show me sneakers', context: { store: freshStore() }, history: [] });
    expect(res.kind).not.toBe('error');
  });

  it('stops calling Gemini for a store that has used its budget, but not for other stores', async () => {
    vi.stubEnv('GEMINI_STORE_MAX_RPM', '1');
    const busy = freshStore();
    script.push(geminiReturns({ task: 'greeting', referencesContextProduct: false }));
    await provider.ask({ message: 'hi', context: { store: busy }, history: [] });
    await provider.ask({ message: 'hi', context: { store: busy }, history: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    script.push(geminiReturns({ task: 'greeting', referencesContextProduct: false }));
    await provider.ask({ message: 'hi', context: { store: freshStore() }, history: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('checkedAnswer', () => {
  const facts = 'Price: ₦85,000\nWas: ₦100,000';
  it('keeps prices that are in the facts', () => {
    expect(checkedAnswer('It is ₦85,000, down from ₦100,000.', facts)).not.toBeNull();
  });
  it('rejects a price that is not', () => {
    expect(checkedAnswer('It is only ₦80,000 today.', facts)).toBeNull();
    expect(checkedAnswer('About 70k naira.', facts)).toBeNull();
  });
  it('rejects links', () => {
    expect(checkedAnswer('See https://example.com', facts)).toBeNull();
  });
});
