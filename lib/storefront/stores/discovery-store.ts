'use client';

/*
 * A one-slot hand-off between the server-rendered discovery bands (shopping
 * missions, budget bands) and the client hero that owns the results surface.
 *
 * Those bands are server components with no JS of their own — keeping them
 * that way matters, they're most of the homepage. Rather than make them
 * client islands, a tile publishes the query it represents here and the hero
 * (already a client component) picks it up and runs it.
 *
 * Ephemeral on purpose: never persisted, and cleared as soon as the hero has
 * consumed it, so a back-navigation doesn't re-run a stale search.
 */
import { create } from 'zustand';

export interface DiscoveryRequest {
  /** free text, parsed by lib/ai/intent.ts */
  q?: string;
  /** a mission id from lib/storefront/discovery.ts */
  mission?: string;
  minPrice?: number;
  maxPrice?: number;
  /** shown as the results heading, e.g. "Gym" or "Under ₦50,000" */
  label: string;
}

interface DiscoveryState {
  request: DiscoveryRequest | null;
  /** nudged on every submit so repeating the same tile re-runs the search */
  nonce: number;
  submit: (request: DiscoveryRequest) => void;
  clear: () => void;
}

export const useDiscoveryStore = create<DiscoveryState>((set) => ({
  request: null,
  nonce: 0,
  submit: (request) => set((s) => ({ request, nonce: s.nonce + 1 })),
  clear: () => set({ request: null }),
}));
