// @vitest-environment jsdom
/*
 * The cart store, over a real localStorage.
 *
 * What the pure tests in lib/storefront/cart.test.ts can't cover: that the
 * bag actually comes back after a refresh, that a corrupt payload recovers
 * instead of throwing, and — the one that matters for a multi-tenant
 * platform — that Store A's bag is invisible to Store B in the same browser.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useCartStore } from './cart-store';
import { storeKey } from './storage';
import { lineKey, toCartLine } from '../cart';
import { PRODUCTS } from '../mock/products';

const multi = PRODUCTS.find((p) => p.options.length > 0 && p.variants.filter((v) => v.stock > 1).length >= 2)!;
const simple = PRODUCTS.find((p) => p.options.length === 0 && p.variants[0]?.stock > 1)!;

const lineA = toCartLine(simple, simple.variants[0].id)!;
const keyA = lineKey(lineA);

function setOrg(slug: string) {
  window.__SF_ORG__ = slug;
}

function reset() {
  window.localStorage.clear();
  setOrg('acme');
  useCartStore.setState({ items: [], savedForLater: [], coupon: null, hydrated: true });
}

beforeEach(reset);

describe('cart operations', () => {
  it('adds, counts and subtotals', () => {
    const store = useCartStore.getState();
    store.addItem(lineA, 2);

    expect(useCartStore.getState().count()).toBe(2);
    expect(useCartStore.getState().lineCount()).toBe(1);
    expect(useCartStore.getState().subtotal()).toBe(lineA.unitPrice * 2);
    expect(useCartStore.getState().hasItem(keyA)).toBe(true);
    expect(useCartStore.getState().getItem(keyA)?.quantity).toBe(2);
    expect(useCartStore.getState().isEmpty()).toBe(false);
  });

  it('keeps two variants of one product apart', () => {
    const [a, b] = multi.variants.filter((v) => v.stock > 0);
    useCartStore.getState().addItem(toCartLine(multi, a.id)!, 1);
    useCartStore.getState().addItem(toCartLine(multi, b.id)!, 1);

    expect(useCartStore.getState().items).toHaveLength(2);
    expect(useCartStore.getState().count()).toBe(2);
  });

  it('updates quantity and refuses to go below 1', () => {
    useCartStore.getState().addItem(lineA, 2);
    useCartStore.getState().updateQuantity(keyA, 5);
    expect(useCartStore.getState().getItem(keyA)?.quantity).toBe(Math.min(5, lineA.maxQuantity));

    useCartStore.getState().updateQuantity(keyA, 0);
    expect(useCartStore.getState().getItem(keyA)?.quantity).toBe(1);
    expect(useCartStore.getState().items).toHaveLength(1);
  });

  it('removes a single line', () => {
    useCartStore.getState().addItem(lineA, 1);
    useCartStore.getState().removeItem(keyA);
    expect(useCartStore.getState().items).toEqual([]);
    expect(useCartStore.getState().isEmpty()).toBe(true);
    expect(useCartStore.getState().count()).toBe(0);
  });

  it('clears everything', () => {
    useCartStore.getState().addItem(lineA, 3);
    useCartStore.getState().clear();
    expect(useCartStore.getState().items).toEqual([]);
    expect(useCartStore.getState().subtotal()).toBe(0);
  });

  it('moves a line to saved-for-later and back', () => {
    useCartStore.getState().addItem(lineA, 2);
    useCartStore.getState().saveForLater(keyA);
    expect(useCartStore.getState().items).toEqual([]);
    expect(useCartStore.getState().savedForLater).toHaveLength(1);

    useCartStore.getState().moveToCart(keyA);
    expect(useCartStore.getState().getItem(keyA)?.quantity).toBe(2);
    expect(useCartStore.getState().savedForLater).toEqual([]);
  });
});

describe('persistence', () => {
  it('writes the bag under the tenant-namespaced key and restores it', async () => {
    useCartStore.getState().addItem(lineA, 2);

    const raw = window.localStorage.getItem(storeKey('cart'));
    expect(raw).toBeTruthy();
    expect(raw).toContain(simple.id);

    /* A refresh: in-memory state is gone, storage isn't. (Emptying the state
     * persists that emptiness — the store writes on every change — so the
     * stored payload is put back to stand in for a fresh page load.) */
    useCartStore.setState({ items: [] });
    window.localStorage.setItem(storeKey('cart'), raw!);
    await useCartStore.persist.rehydrate();

    expect(useCartStore.getState().items).toHaveLength(1);
    expect(useCartStore.getState().getItem(keyA)?.quantity).toBe(2);
  });

  it('reports itself hydrated even when there is nothing stored', async () => {
    /* The cart page renders a skeleton until this flips, so a first-time
     * visitor with an empty localStorage must not be left staring at one. */
    window.localStorage.clear();
    useCartStore.setState({ hydrated: false });
    await useCartStore.persist.rehydrate();
    expect(useCartStore.getState().hydrated).toBe(true);
  });

  it('recovers to an empty bag from a corrupt payload', async () => {
    window.localStorage.setItem(storeKey('cart'), '{not json at all');
    await useCartStore.persist.rehydrate();
    expect(useCartStore.getState().items).toEqual([]);
  });

  it('drops invalid lines from an otherwise readable payload', async () => {
    window.localStorage.setItem(
      storeKey('cart'),
      JSON.stringify({
        version: 1,
        state: { items: [{ productId: 'ghost' }, { ...lineA, quantity: 1, addedAt: 1 }], savedForLater: [] },
      }),
    );
    await useCartStore.persist.rehydrate();

    expect(useCartStore.getState().items).toHaveLength(1);
    expect(useCartStore.getState().items[0].productId).toBe(simple.id);
  });

  it('discards a payload written by an older cart format', async () => {
    window.localStorage.setItem(
      storeKey('cart'),
      JSON.stringify({ version: 0, state: { items: [{ ...lineA, quantity: 1, addedAt: 1 }] } }),
    );
    await useCartStore.persist.rehydrate();
    expect(useCartStore.getState().items).toEqual([]);
  });
});

describe('multi-tenant isolation', () => {
  it('does not show one store’s bag on another store', async () => {
    setOrg('acme');
    useCartStore.getState().addItem(lineA, 1);
    expect(window.localStorage.getItem(storeKey('cart'))).toBeTruthy();

    // Same browser, different storefront.
    setOrg('other-store');
    useCartStore.setState({ items: [] });
    await useCartStore.persist.rehydrate();
    expect(useCartStore.getState().items).toEqual([]);

    // And the first store's bag is still there, untouched.
    setOrg('acme');
    await useCartStore.persist.rehydrate();
    expect(useCartStore.getState().items).toHaveLength(1);
  });

  it('namespaces the storage key by tenant', () => {
    setOrg('acme');
    const a = storeKey('cart');
    setOrg('beta');
    expect(storeKey('cart')).not.toBe(a);
  });
});

describe('reconcile', () => {
  it('applies catalogue truth to the stored bag', () => {
    useCartStore.getState().addItem({ ...lineA, unitPrice: 1 }, 1);
    const notices = useCartStore.getState().reconcile([simple], true);

    expect(useCartStore.getState().getItem(keyA)?.unitPrice).toBe(simple.variants[0].price);
    expect(notices.some((n) => n.kind === 'price-changed')).toBe(true);
  });

  it('drops a line whose product has left the catalogue', () => {
    useCartStore.getState().addItem(lineA, 1);
    useCartStore.getState().reconcile([], true);
    expect(useCartStore.getState().items).toEqual([]);
  });
});
