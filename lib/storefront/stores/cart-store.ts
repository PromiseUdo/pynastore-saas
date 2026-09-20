'use client';

/*
 * The cart store: the ONLY thing in the app that knows where a cart is kept.
 *
 * Components address lines by `lineKey(item)` (product + variant — see
 * lib/storefront/cart.ts) and call these actions; nothing outside this file
 * touches localStorage, and nothing outside lib/storefront/pricing.ts adds
 * up money. That boundary is the point: when the cart becomes a server cart,
 * this file grows a fetch and the cart page, drawer, header badge, PDP and
 * product cards are untouched.
 *
 * Line items hold a price/title/image snapshot so the cart renders instantly
 * and survives catalogue changes. The snapshot is NOT authoritative — see
 * `reconcileCart` in lib/storefront/cart.ts, and eventually the backend,
 * which revalidates price and stock before an order exists.
 *
 * Persistence is namespaced per tenant by `safeStorage` (stores/storage.ts),
 * so two storefronts open in one browser cannot see each other's bag.
 */
import * as React from 'react';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AppliedCoupon, CartItem, OrderTotals, ShippingMethod } from '../types';
import { cartItemCount, cartSubtotal, computeTotals } from '../pricing';
import { applyDiscountCodeAction } from '@/features/shop-orders/actions';
import {
  CART_STORAGE_VERSION,
  addLine,
  lineKey,
  normalizeQuantity,
  reconcileCart,
  sanitizeCartItems,
  type CartLineInput,
  type CartNotice,
} from '../cart';
import { safeStorage, storeKey, followActiveOrg } from './storage';

const PERSIST_NAME = 'cart';

export interface CartState {
  items: CartItem[];
  savedForLater: CartItem[];
  coupon: AppliedCoupon | null;
  shippingMethodId: string | null;
  hydrated: boolean;

  /* mutations — `key` is always `lineKey(item)` */
  addItem: (item: CartLineInput, quantity?: number) => void;
  updateQuantity: (key: string, quantity: number) => void;
  removeItem: (key: string) => void;
  clear: () => void;
  saveForLater: (key: string) => void;
  moveToCart: (key: string) => void;
  removeSaved: (key: string) => void;
  /** replace the cart with a catalogue-checked version (see reconcileCart) */
  reconcile: (products: Parameters<typeof reconcileCart>[1], authoritative?: boolean) => CartNotice[];

  /** checks the code against the merchant's own codes (server) and keeps it */
  applyCoupon: (code: string) => Promise<{ ok: boolean; error?: string }>;
  removeCoupon: () => void;
  setShippingMethod: (id: string | null) => void;

  /* selectors — derived, never stored */
  count: () => number;
  lineCount: () => number;
  subtotal: () => number;
  totals: (shippingMethod?: ShippingMethod | null) => OrderTotals;
  isEmpty: () => boolean;
  getItem: (key: string) => CartItem | undefined;
  getItems: () => CartItem[];
  hasItem: (key: string) => boolean;
  hasProduct: (productId: string) => boolean;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      savedForLater: [],
      coupon: null,
      shippingMethodId: 'standard',
      hydrated: false,

      addItem: (item, quantity = 1) => set((state) => ({ items: addLine(state.items, item, quantity) })),

      /* Zero is not reachable from a stepper: removing is its own action. */
      updateQuantity: (key, quantity) =>
        set((state) => ({
          items: state.items.map((i) =>
            lineKey(i) === key ? { ...i, quantity: normalizeQuantity(quantity, i.maxQuantity) } : i,
          ),
        })),

      removeItem: (key) => set((state) => ({ items: state.items.filter((i) => lineKey(i) !== key) })),

      clear: () => set({ items: [], coupon: null }),

      saveForLater: (key) =>
        set((state) => {
          const item = state.items.find((i) => lineKey(i) === key);
          if (!item) return state;
          return {
            items: state.items.filter((i) => lineKey(i) !== key),
            savedForLater: [item, ...state.savedForLater.filter((i) => lineKey(i) !== key)],
          };
        }),

      moveToCart: (key) =>
        set((state) => {
          const item = state.savedForLater.find((i) => lineKey(i) === key);
          if (!item) return state;
          const { quantity, addedAt: _addedAt, ...line } = item;
          return {
            savedForLater: state.savedForLater.filter((i) => lineKey(i) !== key),
            items: addLine(state.items, line, quantity),
          };
        }),

      removeSaved: (key) =>
        set((state) => ({ savedForLater: state.savedForLater.filter((i) => lineKey(i) !== key) })),

      reconcile: (products, authoritative = false) => {
        const { items, notices, changed } = reconcileCart(get().items, products, { authoritative });
        if (changed) set({ items });
        return notices;
      },

      /* The merchant's codes live on the server, and only the server can say
       * whether one is live, still has uses left and clears its minimum. What
       * comes back is kept so the bag can show the saving — it is a PREVIEW,
       * re-checked when the order is placed (lib/storefront/orders/create.ts),
       * which is the check that decides what is charged. */
      applyCoupon: async (code) => {
        const result = await applyDiscountCodeAction({
          code,
          subtotal: cartSubtotal(get().items),
        });
        if (!result.ok) return { ok: false, error: result.message };
        set({ coupon: result.coupon });
        return { ok: true };
      },
      removeCoupon: () => set({ coupon: null }),
      setShippingMethod: (id) => set({ shippingMethodId: id }),

      count: () => cartItemCount(get().items),
      lineCount: () => get().items.length,
      subtotal: () => cartSubtotal(get().items),
      /* Returns a FRESH object: call it from an event handler or a memo, not
       * from a `useCartStore(s => s.totals())` selector, which would hand
       * React a new snapshot on every render. */
      totals: (shippingMethod = null) =>
        computeTotals({ items: get().items, coupon: get().coupon, shippingMethod }),
      isEmpty: () => get().items.length === 0,
      getItem: (key) => get().items.find((i) => lineKey(i) === key),
      getItems: () => get().items,
      hasItem: (key) => get().items.some((i) => lineKey(i) === key),
      hasProduct: (productId) => get().items.some((i) => i.productId === productId),
    }),
    {
      name: PERSIST_NAME,
      version: CART_STORAGE_VERSION,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({
        items: s.items,
        savedForLater: s.savedForLater,
        coupon: s.coupon,
        shippingMethodId: s.shippingMethodId,
      }),
      /* A payload written by an older, differently-shaped build is not worth
       * guessing at — start clean rather than render something malformed. */
      migrate: () => ({ items: [], savedForLater: [], coupon: null, shippingMethodId: 'standard' }),
      /* Everything read back from localStorage is treated as hostile: it is
       * user-writable and outlives deploys. */
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<CartState>;
        return {
          ...current,
          ...stored,
          items: sanitizeCartItems(stored.items),
          savedForLater: sanitizeCartItems(stored.savedForLater),
          coupon: stored.coupon && typeof stored.coupon.code === 'string' ? stored.coupon : null,
        };
      },
      onRehydrateStorage: () => (state) => {
        if (state) state.hydrated = true;
        else useCartStore.setState({ hydrated: true });
      },
    },
  ),
);

followActiveOrg(useCartStore);

/**
 * Keep the bag in step across tabs.
 *
 * Two tabs of the same store are common (a product opened in a new tab), and
 * a bag that silently disagrees with itself is worse than one that lags. The
 * `storage` event only fires in the OTHER tabs, so this cannot loop; it is
 * scoped to this tenant's key, so a sibling storefront's write is ignored.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key && event.key === storeKey(PERSIST_NAME)) {
      void useCartStore.persist.rehydrate();
    }
  });
}

/**
 * Hydration-safe cart reads.
 *
 * The server has no bag, so rendering one during SSR guarantees a mismatch
 * and a flash of the wrong count. `useSyncExternalStore` returns the server
 * snapshot until the client has hydrated, then the real one — which is the
 * React-blessed version of the `useHydrated()` dance the header used to do
 * by hand.
 */
export function useCartCount(): number {
  return React.useSyncExternalStore(
    useCartStore.subscribe,
    () => useCartStore.getState().count(),
    () => 0,
  );
}
