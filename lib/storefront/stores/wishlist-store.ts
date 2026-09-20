'use client';

/*
 * The saved list.
 *
 * ONE store, two homes. For a guest it lives in this browser and nowhere
 * else. For a signed-in shopper the account is the real list and this is a
 * local copy kept in step: every change is applied here first and then sent
 * to the server, because tapping a heart has to feel instant and a saved
 * item is a convenience, not an order. A failed write costs a save, and the
 * next page load re-reads the account's list and puts it right.
 *
 * `accountId` is what makes signing in and out safe:
 *   null            → these are a guest's saves, in this browser.
 *   a customer id   → these belong to that account.
 * The sync component (components/storefront/wishlist/wishlist-sync.tsx)
 * compares it with whoever is signed in and merges, adopts or clears. It is
 * persisted for one reason: on a shared device, saves belonging to an
 * account must not still be sitting there for the next person.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeStorage, followActiveOrg } from './storage';
import {
  removeFromWishlistAction,
  saveToWishlistAction,
} from '@/features/shop-account/wishlist-actions';

export interface WishlistEntry {
  productId: string;
  slug: string;
  addedAt: number;
}

interface WishlistState {
  items: WishlistEntry[];
  hydrated: boolean;
  /** the account these saves belong to, or null for a guest's browser */
  accountId: string | null;

  toggle: (entry: Omit<WishlistEntry, 'addedAt'>) => boolean; // returns new "is-wishlisted" state
  add: (entry: Omit<WishlistEntry, 'addedAt'>) => void;
  remove: (productId: string) => void;
  clear: () => void;
  has: (productId: string) => boolean;
  count: () => number;

  /** adopt a list that came from the server, wholesale */
  adopt: (entries: WishlistEntry[], accountId: string) => void;
  /** forget an account's saves — on sign-out, or when someone else signs in */
  reset: () => void;
}

/* Fire-and-forget: the browser copy is already correct, and there is nothing
 * useful to tell a shopper if the write fails. */
function push(promise: Promise<unknown>) {
  void promise.catch(() => {});
}

export const useWishlistStore = create<WishlistState>()(
  persist(
    (set, get) => ({
      items: [],
      hydrated: false,
      accountId: null,

      toggle: (entry) => {
        const has = get().items.some((i) => i.productId === entry.productId);
        if (has) get().remove(entry.productId);
        else get().add(entry);
        return !has;
      },

      add: (entry) => {
        if (get().items.some((i) => i.productId === entry.productId)) return;
        set((s) => ({ items: [{ ...entry, addedAt: Date.now() }, ...s.items] }));
        if (get().accountId) push(saveToWishlistAction(entry.productId));
      },

      remove: (productId) => {
        set((s) => ({ items: s.items.filter((i) => i.productId !== productId) }));
        if (get().accountId) push(removeFromWishlistAction(productId));
      },

      clear: () => {
        const { items, accountId } = get();
        set({ items: [] });
        if (accountId) items.forEach((item) => push(removeFromWishlistAction(item.productId)));
      },

      has: (productId) => get().items.some((i) => i.productId === productId),
      count: () => get().items.length,

      adopt: (entries, accountId) => set({ items: entries, accountId }),
      reset: () => set({ items: [], accountId: null }),
    }),
    {
      name: 'wishlist',
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ items: s.items, accountId: s.accountId }),
      onRehydrateStorage: () => (state) => {
        if (state) state.hydrated = true;
      },
    },
  ),
);

followActiveOrg(useWishlistStore);
