/*
 * The classifier as a pure unit: words in, task and constraints out.
 *
 * Vocabulary is a miniature stand-in for a tenant's own categories and
 * brands (the real one is built by `buildIntentVocabulary`), which is the
 * point — nothing in the classifier knows what a sneaker is until the store
 * says it sells them.
 */
import { describe, expect, it } from 'vitest';
import type { IntentVocabulary } from '../intent';
import { carryForward, classifyMessage, detectTopic, extractNamedProduct } from './classify';

const vocab: IntentVocabulary = {
  categories: [
    { name: 'Fashion & Clothing', path: ['fashion'] },
    { name: 'Sneakers', path: ['fashion', 'shoes', 'sneakers'] },
    { name: 'Laptops', path: ['electronics', 'computers', 'laptops'] },
  ],
  brands: [{ name: 'Orbit Audio', slug: 'orbit' }],
  currencyScale: 100,
  formatMoney: (minor) => `₦${(minor / 100).toLocaleString('en-NG')}`,
};

const task = (message: string, opts: Parameters<typeof classifyMessage>[1] = { vocab }) =>
  classifyMessage(message, opts).task;

describe('task classification', () => {
  it('reads an ordinary request as a search, with real constraints', () => {
    const intent = classifyMessage('I need a black sneaker under ₦80k', { vocab });

    expect(intent.task).toBe('search');
    expect(intent.filters.categoryPath).toEqual(['fashion', 'shoes', 'sneakers']);
    expect(intent.filters.maxPrice).toBe(8_000_000);
    expect(intent.filters.query).toContain('black');
  });

  it('distinguishes the three alternative verbs', () => {
    expect(task('show me something cheaper')).toBe('cheaper');
    expect(task('anything similar but cheaper?')).toBe('cheaper');
    expect(task('show me something better')).toBe('premium');
    expect(task('is there a more premium version?')).toBe('premium');
    expect(task('show me similar products')).toBe('similar');
  });

  it('treats "better than X" as a comparison, not a request to trade up', () => {
    expect(task('is this better than the Nike Air Max?')).toBe('compare');
    expect(task('compare this with the Orbit Audio one')).toBe('compare');
    expect(task('which is better?')).toBe('compare');
  });

  it('only ranks when there is a set on screen to rank', () => {
    expect(task('which one has the best rating?', { vocab, hasLastProducts: true })).toBe('rank');
    // Without a referent it is a search — the sort hint is already captured.
    const intent = classifyMessage('which one has the best rating?', { vocab });
    expect(intent.task).toBe('search');
    expect(intent.filters.sort).toBe('rating');
  });

  it('routes a product question only when a product is in hand', () => {
    expect(task('is this waterproof?', { vocab, hasContextProduct: true })).toBe('product_question');
    expect(task('what is the material?', { vocab, hasContextProduct: true })).toBe('product_question');
    // No product in context: it is a search, and must not be answered as
    // though something were open.
    expect(task('is this waterproof?', { vocab })).toBe('search');
  });

  it('sends store questions to the policy path', () => {
    expect(task('what is your return policy?')).toBe('policy');
    expect(task('how long does delivery take?')).toBe('policy');
    expect(task('do you offer pickup?')).toBe('policy');
  });

  it('declines general knowledge but keeps shopping questions', () => {
    expect(task('what is the capital of France?')).toBe('out_of_scope');
    expect(task('tell me a joke')).toBe('out_of_scope');
    // A shopping signal keeps it in scope even with a trivia-shaped opener.
    expect(task('who makes the cheapest laptops?')).not.toBe('out_of_scope');
    expect(task('define the fit of this shirt', { vocab, hasContextProduct: true })).not.toBe(
      'out_of_scope',
    );
  });

  it('treats a bare greeting as the empty state', () => {
    expect(task('hi')).toBe('greeting');
    expect(task('hello!')).toBe('greeting');
    expect(task('')).toBe('greeting');
  });

  it('notices when the shopper means the product in front of them', () => {
    expect(
      classifyMessage('is this any good', { vocab, hasContextProduct: true })
        .referencesContextProduct,
    ).toBe(true);
    expect(
      classifyMessage('show me laptops', { vocab, hasContextProduct: true })
        .referencesContextProduct,
    ).toBe(false);
  });
});

describe('carrying a subject forward', () => {
  it('merges a bare constraint onto the last turn that had a subject', () => {
    const intent = classifyMessage('under ₦80k', {
      vocab,
      previousUserMessages: ['I need sneakers'],
    });

    expect(intent.task).toBe('refine');
    expect(intent.filters.categoryPath).toEqual(['fashion', 'shoes', 'sneakers']);
    expect(intent.filters.maxPrice).toBe(8_000_000);
  });

  it('leaves a self-contained message alone', () => {
    const intent = classifyMessage('show me laptops under ₦900,000', {
      vocab,
      previousUserMessages: ['I need sneakers'],
    });

    expect(intent.task).toBe('search');
    expect(intent.filters.categoryPath).toEqual(['electronics', 'computers', 'laptops']);
  });

  it('does not carry anything forward when there is nothing to add', () => {
    expect(
      carryForward({ recognised: [] }, ['I need sneakers'], vocab),
    ).toBeNull();
  });

  it('walks back past turns that had no subject', () => {
    const merged = carryForward({ maxPrice: 5_000_000, recognised: [] }, ['I need sneakers', 'ok'], vocab);
    expect(merged?.categoryPath).toEqual(['fashion', 'shoes', 'sneakers']);
  });
});

describe('question topics', () => {
  it('identifies what a question is about', () => {
    expect(detectTopic('does it come in size 42?')).toBe('sizing');
    expect(detectTopic('is this waterproof?')).toBe('water');
    expect(detectTopic('what is the material?')).toBe('material');
    expect(detectTopic('do people like this product?')).toBe('reviews');
    expect(detectTopic('is this worth the price?')).toBe('value');
    expect(detectTopic('is this good for running?')).toBe('suitability');
    expect(detectTopic('do you have this in blue?')).toBe('stock');
  });

  it('returns unknown rather than guessing', () => {
    expect(detectTopic('will my neighbour approve of this?')).toBe('unknown');
  });
});

describe('naming the other product in a comparison', () => {
  it('extracts the referenced name', () => {
    expect(extractNamedProduct('is this better than the Nike Air Max?')).toBe('Nike Air Max');
    expect(extractNamedProduct('compare it with the Orbit Audio Studio')).toBe('Orbit Audio Studio');
    expect(extractNamedProduct('this vs the Vellum 14')).toBe('Vellum 14');
  });

  it('returns nothing when no product is named', () => {
    expect(extractNamedProduct('which is better?')).toBeUndefined();
  });
});

describe('ranking what is on screen by price', () => {
  it('reads "which of these is cheaper?" as a price rank, not a request for alternatives', () => {
    const intent = classifyMessage('Which of these is cheaper?', { vocab, hasLastProducts: true });
    expect(intent.task).toBe('rank');
    expect(intent.rankBy).toBe('price');
  });

  it('still means "cheaper alternatives" when nothing is on screen', () => {
    expect(task('show me something cheaper', { vocab, hasContextProduct: true })).toBe('cheaper');
  });
});
