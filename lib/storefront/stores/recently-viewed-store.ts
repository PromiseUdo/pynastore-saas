'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeStorage, followActiveOrg } from './storage';

const LIMIT = 12;

interface RecentlyViewedState {
  ids: string[];
  hydrated: boolean;
  visit: (productId: string) => void;
  clear: () => void;
}

export const useRecentlyViewedStore = create<RecentlyViewedState>()(
  persist(
    (set) => ({
      ids: [],
      hydrated: false,
      visit: (productId) =>
        set((s) => ({ ids: [productId, ...s.ids.filter((id) => id !== productId)].slice(0, LIMIT) })),
      clear: () => set({ ids: [] }),
    }),
    {
      name: 'recently-viewed',
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ ids: s.ids }),
      onRehydrateStorage: () => (state) => {
        if (state) state.hydrated = true;
      },
    },
  ),
);

followActiveOrg(useRecentlyViewedStore);
