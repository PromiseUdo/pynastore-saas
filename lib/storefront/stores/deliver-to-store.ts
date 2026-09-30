'use client';

/*
 * Where the shopper wants things delivered, for estimates before checkout
 * (ROADMAP Phase 9.8): "Ships from Lagos Store · ₦4,500 to Port Harcourt".
 *
 * Kept in this browser, per store (./storage.ts), and only ever used to ask
 * for an estimate and to start the checkout address form — never sent
 * anywhere else. A signed-in shopper with nothing chosen yet is estimated
 * for their default address instead (the server looks it up), and choosing a
 * place here overrides that for this browser.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeStorage, followActiveOrg } from './storage';

export interface DeliverToPlace {
  state: string;
  city: string;
}

interface DeliverToState {
  place: DeliverToPlace | null;
  hydrated: boolean;
  choose: (place: DeliverToPlace) => void;
  clear: () => void;
}

export const useDeliverToStore = create<DeliverToState>()(
  persist(
    (set) => ({
      place: null,
      hydrated: false,
      choose: (place) => set({ place: { state: place.state.trim(), city: place.city.trim() } }),
      clear: () => set({ place: null }),
    }),
    {
      name: 'deliver-to',
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ place: s.place }),
      onRehydrateStorage: () => (state) => {
        if (state) state.hydrated = true;
      },
    },
  ),
);

followActiveOrg(useDeliverToStore);
