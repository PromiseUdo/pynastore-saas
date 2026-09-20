/*
 * Shared persistence plumbing for the storefront's zustand stores.
 *
 * Carts/wishlists must not bleed between tenants when several storefronts
 * are opened in the same browser (dev, or a shared device). Each store
 * persists under a key namespaced by the active org slug, which the
 * `StorefrontProviders` component stamps onto `window` before the stores
 * hydrate.
 */
import type { StateStorage } from 'zustand/middleware';

const PREFIX = 'mansaas:sf';

declare global {
  interface Window {
    __SF_ORG__?: string;
  }
}

export function activeOrgSlug(): string {
  if (typeof window !== 'undefined' && window.__SF_ORG__) return window.__SF_ORG__;
  return 'default';
}

export function storeKey(name: string): string {
  return `${PREFIX}:${activeOrgSlug()}:${name}`;
}

/*
 * Stamping the org during the provider's render is not early enough on its
 * own. On a full page load (refresh, direct link, new tab) a store module can
 * be evaluated — and zustand's `persist` hydrates synchronously at `create`
 * time — BEFORE the provider renders, so it reads the `default` namespace: a
 * refreshed /cart showed "Your bag is empty" with the bag sitting in storage.
 *
 * So every persisted store registers here with the org it hydrated under,
 * and `setActiveOrg` re-reads any store that hydrated under a different one.
 * It runs synchronously inside the provider's render, i.e. before any child
 * renders or runs an effect that could write the empty state back over the
 * real one.
 */
interface FollowingStore {
  persist: { rehydrate: () => Promise<void> | void };
}

const following: { store: FollowingStore; org: string }[] = [];

/** Call once, right after `create(persist(...))`. */
export function followActiveOrg(store: FollowingStore): void {
  following.push({ store, org: activeOrgSlug() });
}

/** Stamp the active org and bring every persisted store onto its namespace. */
export function setActiveOrg(slug: string): void {
  if (typeof window === 'undefined') return;
  window.__SF_ORG__ = slug;
  for (const entry of following) {
    if (entry.org === slug) continue;
    entry.org = slug;
    void entry.store.persist.rehydrate();
  }
}

/**
 * localStorage-backed StateStorage that (a) no-ops during SSR and (b)
 * namespaces the persist `name` by the active org slug, so `persist({
 * name: 'cart' })` actually writes to `mansaas:sf:<org>:cart`.
 */
export const safeStorage: StateStorage = {
  getItem: (name) => {
    try {
      if (typeof window === 'undefined') return null;
      const raw = window.localStorage.getItem(storeKey(name));
      if (raw == null) return null;
      // localStorage is user-writable and outlives deploys, so a stored value
      // may be truncated or hand-edited. Parsing here (and discarding what
      // doesn't parse) means a corrupt payload costs the shopper an empty
      // bag, not a storefront that throws on first paint.
      JSON.parse(raw);
      return raw;
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      if (typeof window !== 'undefined') window.localStorage.setItem(storeKey(name), value);
    } catch {
      /* quota / private mode — ignore */
    }
  },
  removeItem: (name) => {
    try {
      if (typeof window !== 'undefined') window.localStorage.removeItem(storeKey(name));
    } catch {
      /* ignore */
    }
  },
};
