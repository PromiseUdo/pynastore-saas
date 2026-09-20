// @vitest-environment jsdom
/*
 * The assistant, rendered.
 *
 * The suites in lib/ai/assistant prove what the answers say; this proves
 * they reach the screen — that the empty state offers real prompts, that
 * tapping one asks it, that an answer's products render as the storefront's
 * own cards linking to real product pages, that a failure says so rather
 * than spinning, and that the whole thing is operable and announced.
 *
 * The endpoint is stubbed: this is about the UI contract (AssistantResponse
 * in, shopping interface out), which is exactly the seam a real provider
 * will arrive behind.
 */
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssistantPanel } from './assistant-panel';
import { StorefrontProvider } from '@/lib/storefront/context';
import {
  useAssistantStore,
  type AssistantSeed,
} from '@/lib/storefront/stores/assistant-store';
import { quickPromptsFor } from '@/lib/ai/assistant/prompts';
import type { AssistantResponse } from '@/lib/ai/assistant/types';
import { PRODUCTS } from '@/lib/storefront/mock/products';
import { formatMoney } from '@/lib/storefront/format';

vi.mock('next/image', () => ({
  default: ({ src, alt, fill, priority, sizes, ...rest }: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={String(src)} alt={String(alt ?? '')} {...(rest as object)} />
  ),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }),
}));

const PRODUCT = PRODUCTS[0];

const answer = (partial: Partial<AssistantResponse> = {}): AssistantResponse => ({
  kind: 'products',
  message: 'I found 1 option in the store.',
  products: [PRODUCT],
  reasons: { [PRODUCT.id]: `${formatMoney(PRODUCT.priceFrom, PRODUCT.currency)} · in stock` },
  suggestions: ['Show me something cheaper'],
  actions: [],
  intent: { task: 'search', filters: { recognised: [] }, referencesContextProduct: false },
  currency: PRODUCT.currency,
  ...partial,
});

const respondWith = (response: AssistantResponse) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => response })),
  );

/* The seed lives in the store — the same place `send()` reads it from — so
 * the test sets it there rather than passing a prop the panel doesn't have. */
const renderPanel = (seed: AssistantSeed) => {
  useAssistantStore.setState({ seed });
  return render(
    <StorefrontProvider org={{ slug: 'demo', name: 'Demo', logoUrl: null }} isMobileRuntime={false}>
      <AssistantPanel />
    </StorefrontProvider>,
  );
};

beforeEach(() => {
  useAssistantStore.setState({
    open: true,
    seed: null,
    messages: [],
    status: 'idle',
    error: null,
    lastProductIds: [],
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('empty state', () => {
  it('explains what the assistant is for and what it will not do', () => {
    renderPanel({ surface: 'home' });

    expect(screen.getByRole('heading', { name: /shopping assistant/i })).toBeTruthy();
    // The grounding promise is made to the shopper, not just in the code.
    expect(screen.getByText(/won’t make things up/i)).toBeTruthy();
  });

  it('offers the surface’s quick prompts, each keyboard operable', () => {
    renderPanel({ surface: 'product', productSlug: PRODUCT.slug, productName: PRODUCT.name });

    for (const prompt of quickPromptsFor('product')) {
      expect(screen.getByRole('button', { name: prompt })).toBeTruthy();
    }
  });

  it('names the product it is answering about', () => {
    renderPanel({ surface: 'product', productSlug: PRODUCT.slug, productName: PRODUCT.name });
    expect(screen.getByText(new RegExp(PRODUCT.name, 'i'))).toBeTruthy();
  });
});

describe('asking', () => {
  it('sends a tapped quick prompt and renders the answer', async () => {
    respondWith(answer());
    renderPanel({ surface: 'home' });

    const prompt = quickPromptsFor('home')[0];
    await userEvent.click(screen.getByRole('button', { name: prompt }));

    // The shopper's own words stay on screen…
    await waitFor(() => expect(screen.getByText(prompt)).toBeTruthy());
    // …and the answer lands as prose plus real cards.
    expect(screen.getByText('I found 1 option in the store.')).toBeTruthy();
  });

  it('sends what was typed, with the store and prior turns attached', async () => {
    respondWith(answer());
    renderPanel({ surface: 'product', productSlug: PRODUCT.slug, productName: PRODUCT.name });

    await userEvent.type(
      screen.getByLabelText(/ask the shopping assistant/i),
      'is this waterproof?{enter}',
    );

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);

    expect(body.org).toBe('demo');
    expect(body.message).toBe('is this waterproof?');
    // Context is the slug only — the server resolves the row itself.
    expect(body.context.productSlug).toBe(PRODUCT.slug);
    expect(body.context).not.toHaveProperty('product');
  });

  it('carries the ids of the last answer into the next question', async () => {
    respondWith(answer());
    renderPanel({ surface: 'home' });

    const input = screen.getByLabelText(/ask the shopping assistant/i);
    await userEvent.type(input, 'show me laptops{enter}');
    await waitFor(() => expect(screen.getByText(/I found 1 option/)).toBeTruthy());

    await userEvent.type(input, 'which one has the best rating?{enter}');
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBe(2));

    const second = JSON.parse((vi.mocked(fetch).mock.calls[1][1] as RequestInit).body as string);
    expect(second.context.lastProductIds).toEqual([PRODUCT.id]);
    expect(second.history.map((t: { text: string }) => t.text)).toContain('show me laptops');
  });

  it('renders recommendations as the storefront’s own cards, linking to the real page', async () => {
    respondWith(answer());
    renderPanel({ surface: 'home' });

    await userEvent.click(screen.getByRole('button', { name: quickPromptsFor('home')[0] }));
    await waitFor(() => expect(screen.getByText(/I found 1 option/)).toBeTruthy());

    const link = screen.getAllByRole('link', { name: new RegExp(PRODUCT.name, 'i') })[0];
    expect(link.getAttribute('href')).toBe(`/products/${PRODUCT.slug}`);
  });

  it('turns a suggestion into the next question', async () => {
    respondWith(answer());
    renderPanel({ surface: 'home' });

    await userEvent.click(screen.getByRole('button', { name: quickPromptsFor('home')[0] }));
    await waitFor(() => expect(screen.getByText(/I found 1 option/)).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: 'Show me something cheaper' }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBe(2));

    const second = JSON.parse((vi.mocked(fetch).mock.calls[1][1] as RequestInit).body as string);
    expect(second.message).toBe('Show me something cheaper');
  });
});

describe('response kinds', () => {
  it('renders a follow-up question as clickable options', async () => {
    respondWith(
      answer({
        kind: 'follow_up',
        message: 'What matters most to you?',
        products: [],
        reasons: {},
        suggestions: [],
        followUp: { question: 'What matters most?', options: ['Battery life', 'Portability'] },
      }),
    );
    renderPanel({ surface: 'home' });

    await userEvent.click(screen.getByRole('button', { name: quickPromptsFor('home')[0] }));
    await waitFor(() => expect(screen.getByText('What matters most?')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Battery life' })).toBeTruthy();
  });

  it('renders a comparison as a table with a row per listed detail', async () => {
    const other = PRODUCTS[1];
    respondWith(
      answer({
        kind: 'comparison',
        message: 'Going on what’s listed…',
        products: [PRODUCT, other],
        reasons: {},
        comparison: {
          productIds: [PRODUCT.id, other.id],
          rows: [
            { label: 'Price', values: ['₦1', '₦2'] },
            { label: 'Warranty', values: ['24 months', null] },
          ],
        },
      }),
    );
    renderPanel({ surface: 'home' });

    await userEvent.click(screen.getByRole('button', { name: quickPromptsFor('home')[0] }));
    await waitFor(() => expect(screen.getByRole('table')).toBeTruthy());

    const table = screen.getByRole('table');
    expect(within(table).getByRole('rowheader', { name: 'Price' })).toBeTruthy();
    // An attribute nobody wrote down says so, rather than showing a blank
    // that reads as "doesn't have it".
    expect(within(table).getByText('Not listed')).toBeTruthy();
  });

  it('shows a no-match answer with its recovery actions', async () => {
    respondWith(
      answer({
        kind: 'no_match',
        message: 'I couldn’t find anything matching that under ₦2,000.',
        products: [],
        reasons: {},
        suggestions: [],
        actions: [{ id: 'browse', label: 'Browse Electronics', kind: 'navigate', href: '/c/electronics' }],
      }),
    );
    renderPanel({ surface: 'home' });

    await userEvent.click(screen.getByRole('button', { name: quickPromptsFor('home')[0] }));
    await waitFor(() => expect(screen.getByText(/couldn’t find anything/)).toBeTruthy());

    const action = screen.getByRole('link', { name: /Browse Electronics/i });
    expect(action.getAttribute('href')).toBe('/c/electronics');
  });
});

describe('states and accessibility', () => {
  it('announces the transcript politely and marks itself busy while working', async () => {
    // A request that never resolves, so the loading state can be inspected.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    renderPanel({ surface: 'home' });

    await userEvent.click(screen.getByRole('button', { name: quickPromptsFor('home')[0] }));

    const live = document.querySelector('[aria-live="polite"]')!;
    expect(live).toBeTruthy();
    await waitFor(() => expect(live.getAttribute('aria-busy')).toBe('true'));
    // The wait is described in words, not by a spinner alone.
    expect(screen.getByText(/looking through the store/i)).toBeTruthy();
  });

  it('reports a failure as an alert instead of spinning forever', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    renderPanel({ surface: 'home' });

    await userEvent.click(screen.getByRole('button', { name: quickPromptsFor('home')[0] }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toMatch(/couldn’t reach the store/i);
  });

  it('labels the input and the send button, and disables send on an empty draft', async () => {
    renderPanel({ surface: 'home' });

    expect(screen.getByLabelText(/ask the shopping assistant/i)).toBeTruthy();
    const send = screen.getByRole('button', { name: /send message/i });
    expect(send.hasAttribute('disabled')).toBe(true);

    await userEvent.type(screen.getByLabelText(/ask the shopping assistant/i), 'laptops');
    expect(send.hasAttribute('disabled')).toBe(false);
  });

  it('lets the shopper start over', async () => {
    respondWith(answer());
    renderPanel({ surface: 'home' });

    await userEvent.click(screen.getByRole('button', { name: quickPromptsFor('home')[0] }));
    await waitFor(() => expect(screen.getByText(/I found 1 option/)).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: /start over/i }));
    expect(screen.queryByText(/I found 1 option/)).toBeNull();
    // …back to the empty state, prompts and all.
    expect(screen.getByRole('button', { name: quickPromptsFor('home')[0] })).toBeTruthy();
  });
});
