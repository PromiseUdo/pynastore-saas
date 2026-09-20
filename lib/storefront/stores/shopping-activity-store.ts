'use client';

/*
 * This session's shopping events — see lib/storefront/shopping-events.ts.
 *
 * sessionStorage, not localStorage: behaviour is useful for the visit that
 * produced it and has no business outliving the tab (§22). Namespaced by
 * tenant through `storeKey`, so one store's searches never become another
 * store's signals when both are open in the same browser (§26). Capped, so
 * the log can't grow into a history.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { RecordedShoppingEvent } from '../shopping-events';
import { storeKey, followActiveOrg } from './storage';

export const MAX_STORED_EVENTS = 50;

interface ShoppingActivityState {
  events: RecordedShoppingEvent[];
  record: (event: RecordedShoppingEvent) => void;
  clear: () => void;
}

const sessionStorageDriver = createJSONStorage(() => ({
  getItem: (name: string) => {
    try {
      return typeof window === 'undefined' ? null : window.sessionStorage.getItem(storeKey(name));
    } catch {
      return null;
    }
  },
  setItem: (name: string, value: string) => {
    try {
      if (typeof window !== 'undefined') window.sessionStorage.setItem(storeKey(name), value);
    } catch {
      /* private mode / quota — events are disposable */
    }
  },
  removeItem: (name: string) => {
    try {
      if (typeof window !== 'undefined') window.sessionStorage.removeItem(storeKey(name));
    } catch {
      /* ignore */
    }
  },
}));

export const useShoppingActivityStore = create<ShoppingActivityState>()(
  persist(
    (set) => ({
      events: [],
      record: (event) =>
        set((state) => ({ events: [...state.events, event].slice(-MAX_STORED_EVENTS) })),
      clear: () => set({ events: [] }),
    }),
    {
      name: 'shopping-activity',
      storage: sessionStorageDriver,
      partialize: (state) => ({ events: state.events }),
    },
  ),
);

followActiveOrg(useShoppingActivityStore);
