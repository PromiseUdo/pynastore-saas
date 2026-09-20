'use client';

/* Ephemeral UI state — not persisted. */
import { create } from 'zustand';

type Overlay = 'cart' | 'search' | 'menu' | 'filters' | null;

interface UIState {
  overlay: Overlay;
  /** slug of the product shown in the quick-view modal, or null */
  quickViewSlug: string | null;
  newsletterDismissed: boolean;
  openCart: () => void;
  openSearch: () => void;
  openMenu: () => void;
  openFilters: () => void;
  close: () => void;
  toggle: (o: Exclude<Overlay, null>) => void;
  openQuickView: (slug: string) => void;
  closeQuickView: () => void;
  dismissNewsletter: () => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  overlay: null,
  quickViewSlug: null,
  newsletterDismissed: false,
  openCart: () => set({ overlay: 'cart' }),
  openSearch: () => set({ overlay: 'search' }),
  openMenu: () => set({ overlay: 'menu' }),
  openFilters: () => set({ overlay: 'filters' }),
  close: () => set({ overlay: null }),
  toggle: (o) => set({ overlay: get().overlay === o ? null : o }),
  openQuickView: (slug) => set({ quickViewSlug: slug }),
  closeQuickView: () => set({ quickViewSlug: null }),
  dismissNewsletter: () => set({ newsletterDismissed: true }),
}));
