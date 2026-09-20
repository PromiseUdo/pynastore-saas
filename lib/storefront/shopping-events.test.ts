// @vitest-environment jsdom
/*
 * Phase 11 — the shopping-event boundary.
 *
 * Events are session-scoped and in-browser only; what matters is that they
 * are recorded, capped, turned into the signals recommendations read, and
 * that bag/wishlist changes become events without the stores knowing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  SHOPPING_EVENTS,
  recentCategoryPaths,
  recentQueries,
  subscribeShoppingEvents,
  trackShoppingEvent,
  type RecordedShoppingEvent,
} from './shopping-events';
import { MAX_STORED_EVENTS, useShoppingActivityStore } from './stores/shopping-activity-store';
import { diffProductIds, useShoppingEventBridge } from './use-shopping-event-bridge';
import { useCartStore } from './stores/cart-store';
import { useWishlistStore } from './stores/wishlist-store';
import { toCartLine } from './cart';
import { PRODUCTS } from './mock/products';

beforeEach(() => {
  useShoppingActivityStore.setState({ events: [] });
  useCartStore.setState({ items: [], savedForLater: [], coupon: null, hydrated: true });
  useWishlistStore.setState({ items: [], hydrated: true });
});

afterEach(() => vi.restoreAllMocks());

const names = () => useShoppingActivityStore.getState().events.map((e) => e.name);

describe('tracking', () => {
  it('records events with a timestamp and notifies listeners', () => {
    const listener = vi.fn();
    const off = subscribeShoppingEvents(listener);
    trackShoppingEvent({ name: SHOPPING_EVENTS.productViewed, productId: 'prod_a' });
    off();
    trackShoppingEvent({ name: SHOPPING_EVENTS.productViewed, productId: 'prod_b' });

    expect(names()).toEqual(['product_viewed', 'product_viewed']);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0]).toMatchObject({ productId: 'prod_a', at: expect.any(Number) });
  });

  it('caps the stored log so it can never grow into a history', () => {
    for (let i = 0; i < MAX_STORED_EVENTS + 20; i++) {
      trackShoppingEvent({ name: SHOPPING_EVENTS.productSearched, query: `q${i}` });
    }
    const { events } = useShoppingActivityStore.getState();
    expect(events).toHaveLength(MAX_STORED_EVENTS);
    expect(events.at(-1)).toMatchObject({ query: `q${MAX_STORED_EVENTS + 19}` });
  });

  it('persists to sessionStorage, namespaced by tenant — never localStorage', () => {
    window.__SF_ORG__ = 'acme';
    trackShoppingEvent({ name: SHOPPING_EVENTS.productSearched, query: 'lamp' });
    expect(window.sessionStorage.getItem('mansaas:sf:acme:shopping-activity')).toContain('lamp');
    expect(window.localStorage.getItem('mansaas:sf:acme:shopping-activity')).toBeNull();
  });

  it('a throwing listener cannot break the page that emitted the event', () => {
    const off = subscribeShoppingEvents(() => {
      throw new Error('boom');
    });
    expect(() => trackShoppingEvent({ name: SHOPPING_EVENTS.productViewed, productId: 'prod_a' })).not.toThrow();
    off();
  });
});

describe('derived signals', () => {
  const at = (i: number) => i;
  const log: RecordedShoppingEvent[] = [
    { name: SHOPPING_EVENTS.productSearched, query: 'Sneakers', at: at(1) },
    { name: SHOPPING_EVENTS.categoryViewed, categoryPath: ['fashion', 'shoes'], at: at(2) },
    { name: SHOPPING_EVENTS.productSearched, query: 'bag', at: at(3) },
    { name: SHOPPING_EVENTS.productSearched, query: 'sneakers ', at: at(4) },
    { name: SHOPPING_EVENTS.categoryViewed, categoryPath: ['electronics'], at: at(5) },
    { name: SHOPPING_EVENTS.categoryViewed, categoryPath: ['fashion', 'shoes'], at: at(6) },
  ];

  it('recent queries are distinct, normalised, most recent first', () => {
    expect(recentQueries(log, 5)).toEqual(['sneakers', 'bag']);
    expect(recentQueries(log, 1)).toEqual(['sneakers']);
  });

  it('recent categories are distinct, most recent first', () => {
    expect(recentCategoryPaths(log, 5)).toEqual([['fashion', 'shoes'], ['electronics']]);
  });
});

describe('bag and wishlist bridge', () => {
  it('diffs id lists into added/removed events', () => {
    expect(
      diffProductIds(['a', 'b'], ['b', 'c'], SHOPPING_EVENTS.addedToCart, SHOPPING_EVENTS.removedFromCart),
    ).toEqual([
      { name: 'product_added_to_cart', productId: 'c' },
      { name: 'product_removed_from_cart', productId: 'a' },
    ]);
  });

  it('emits cart and wishlist events from store changes', () => {
    const { unmount } = renderHook(() => useShoppingEventBridge());
    const product = PRODUCTS.find((p) => p.options.length === 0 && p.variants[0].stock > 0);
    if (!product) throw new Error('fixture: needs a simple in-stock product');
    const line = toCartLine(product, product.variants[0].id);
    if (!line) throw new Error('fixture: line');

    useCartStore.getState().addItem(line, 1);
    useCartStore.getState().updateQuantity(`${product.id}::${product.variants[0].id}`, 2);
    useWishlistStore.getState().toggle({ productId: 'prod_saved', slug: 'saved' });
    useWishlistStore.getState().toggle({ productId: 'prod_saved', slug: 'saved' });
    useCartStore.getState().clear();
    unmount();

    // A quantity change is not a new product in the bag.
    expect(names()).toEqual([
      'product_added_to_cart',
      'wishlist_added',
      'wishlist_removed',
      'product_removed_from_cart',
    ]);
  });

  it('ignores the store restoring itself from storage', () => {
    useCartStore.setState({ hydrated: false });
    renderHook(() => useShoppingEventBridge());
    const product = PRODUCTS[0];
    const line = toCartLine(product, product.variants[0].id);
    if (!line) throw new Error('fixture: line');
    useCartStore.setState({ items: [{ ...line, quantity: 1, addedAt: 1 }] });
    expect(names()).toEqual([]);
  });
});
