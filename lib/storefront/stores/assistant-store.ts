'use client';

/*
 * Conversation state for the shopping assistant.
 *
 * Lives beside the other storefront stores (cart, wishlist, discovery)
 * rather than inside lib/ai, because it is UI state: what is on screen, what
 * is in flight, and which page opened the panel. Nothing here knows what a
 * provider is — it posts to /api/storefront/assistant and renders whatever
 * AssistantResponse comes back, which is what lets a real model land without
 * touching a component (§34).
 *
 * Short-term by design (§24/§25): the transcript persists to sessionStorage
 * so a refresh mid-conversation doesn't lose the thread, and dies with the
 * tab. Nothing is written to a database, nothing is keyed to a person, and
 * the only thing sent back to the server is the last few turns of text plus
 * ids the server re-resolves for itself.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AssistantResponse, AssistantTurn } from '@/lib/ai/assistant/types';
import { MAX_HISTORY_TURNS } from '@/lib/ai/assistant/types';
import { storeKey, followActiveOrg } from './storage';

/** Where the panel was opened from — decides the empty state and prompts. */
export type AssistantSurface = 'home' | 'product' | 'search' | 'cart' | 'category';

/**
 * The page context handed to the assistant. Ids and a query string only
 * (§10) — the server re-reads every row through the tenant's catalogue, so
 * nothing here is trusted as product data.
 */
export interface AssistantSeed {
  surface: AssistantSurface;
  productSlug?: string;
  productName?: string;
  categoryPath?: string[];
  collectionSlug?: string;
  searchQuery?: string;
  cartProductIds?: string[];
  /** sent as the first message when the panel opens */
  initialMessage?: string;
}

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** assistant turns carry the structured payload the UI renders */
  response?: AssistantResponse;
}

interface AssistantState {
  open: boolean;
  seed: AssistantSeed | null;
  messages: AssistantMessage[];
  status: 'idle' | 'thinking' | 'error';
  error: string | null;
  /** ids the last answer put on screen — what "which one…" refers to */
  lastProductIds: string[];

  openPanel: (seed: AssistantSeed, org: string) => void;
  closePanel: () => void;
  send: (text: string, org: string) => Promise<void>;
  reset: () => void;
}

/*
 * Session, not local: a shopping conversation is about this visit. Reusing
 * `storeKey` keeps it namespaced per tenant exactly like the cart, so two
 * storefronts open in one browser never see each other's thread.
 */
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
      /* private mode / quota — the conversation is disposable, so ignore */
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

let counter = 0;
const nextId = () => `m${Date.now().toString(36)}${(counter++).toString(36)}`;

export const useAssistantStore = create<AssistantState>()(
  persist(
    (set, get) => ({
      open: false,
      seed: null,
      messages: [],
      status: 'idle',
      error: null,
      lastProductIds: [],

      openPanel: (seed, org) => {
        const previous = get().seed;
        /* Moving to a different product starts a fresh thread: answers about
         * the last one would read as answers about this one. */
        const changedSubject =
          previous?.surface !== seed.surface || previous?.productSlug !== seed.productSlug;

        set({
          open: true,
          seed,
          error: null,
          ...(changedSubject ? { messages: [], lastProductIds: [], status: 'idle' as const } : {}),
        });

        if (seed.initialMessage) void get().send(seed.initialMessage, org);
      },

      closePanel: () => set({ open: false }),

      reset: () => set({ messages: [], lastProductIds: [], status: 'idle', error: null }),

      async send(text, org) {
        const message = text.trim();
        if (!message || get().status === 'thinking') return;

        const seed = get().seed;
        const history: AssistantTurn[] = get()
          .messages.slice(-MAX_HISTORY_TURNS)
          .map((m) => ({ role: m.role, text: m.text }));

        set((state) => ({
          messages: [...state.messages, { id: nextId(), role: 'user', text: message }],
          status: 'thinking',
          error: null,
        }));

        try {
          const res = await fetch('/api/storefront/assistant', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              org,
              message,
              history,
              context: {
                productSlug: seed?.productSlug,
                categoryPath: seed?.categoryPath,
                collectionSlug: seed?.collectionSlug,
                searchQuery: seed?.searchQuery,
                cartProductIds: seed?.cartProductIds?.slice(0, 50),
                lastProductIds: get().lastProductIds,
              },
            }),
          });
          if (res.status === 429) {
            /* Rate limited: the server's sentence says "slow down", which is
             * truer than "couldn't reach the store". */
            const body = await res.json().catch(() => null);
            set({
              status: 'error',
              error:
                typeof body?.error === 'string'
                  ? body.error
                  : 'You’re sending messages a little fast. Give it a moment and try again.',
            });
            return;
          }
          if (!res.ok) throw new Error(String(res.status));

          const response: AssistantResponse = await res.json();
          set((state) => ({
            messages: [
              ...state.messages,
              { id: nextId(), role: 'assistant', text: response.message, response },
            ],
            lastProductIds: response.products.map((p) => p.id),
            status: 'idle',
          }));
        } catch {
          set({
            status: 'error',
            error: 'I couldn’t reach the store just then. Try that again?',
          });
        }
      },
    }),
    {
      name: 'assistant',
      storage: sessionStorageDriver,
      /* Only the transcript is worth restoring. `open` is not: a refresh
       * should not reopen a panel the shopper may have closed, and an
       * in-flight `status` would restore as a spinner that never resolves. */
      partialize: (state) => ({
        messages: state.messages,
        seed: state.seed,
        lastProductIds: state.lastProductIds,
      }),
    },
  ),
);

followActiveOrg(useAssistantStore);
