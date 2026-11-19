'use client';

/*
 * Whether "Help me choose" is open. It is one modal for the whole shop
 * (components/storefront/discovery/guided-dialog.tsx, mounted by the shop's
 * layout), opened from the helper button in the corner or the homepage hero.
 * Nothing is saved: a closed modal starts again from the first question.
 */
import { create } from 'zustand';

interface GuidedState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useGuidedStore = create<GuidedState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
