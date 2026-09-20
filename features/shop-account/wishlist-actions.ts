'use server';

/*
 * features/shop-account/wishlist-actions.ts
 *
 * Saving things for later, for a shopper who is signed in.
 *
 * These are called from the wishlist store's write-through
 * (lib/storefront/stores/wishlist-store.ts), which updates the browser copy
 * first and then tells the server. That order is deliberate: tapping a heart
 * must feel instant, and the list is a convenience — a failed write loses a
 * saved item, not an order.
 *
 * A guest reaches none of this. `context()` returns null without a session
 * and every action answers false, which is exactly what the store does
 * anyway when it has no account to write to.
 */
import {
  addToWishlist,
  listWishlist,
  mergeWishlist,
  removeFromWishlist,
} from '@/lib/storefront/account/wishlist';
import { findStoreBySlug } from '@/lib/storefront/account/shopper';
import { currentStoreSlug, getShopper } from '@/lib/storefront/account/session';

async function context() {
  const slug = await currentStoreSlug();
  const [store, shopper] = await Promise.all([slug ? findStoreBySlug(slug) : null, getShopper()]);
  if (!store || !shopper) return null;
  return { organizationId: store.id, customerId: shopper.id };
}

export async function saveToWishlistAction(productId: string): Promise<boolean> {
  const scope = await context();
  if (!scope || !productId) return false;
  return addToWishlist(scope, productId);
}

export async function removeFromWishlistAction(productId: string): Promise<boolean> {
  const scope = await context();
  if (!scope || !productId) return false;
  return removeFromWishlist(scope, productId);
}

/**
 * Fold what the browser was holding into the account, and hand back the
 * whole list so the browser can adopt it.
 *
 * Runs once per sign-in (see the wishlist sync). Sending ids the store
 * doesn't sell is harmless — they're dropped, not saved.
 */
export async function mergeWishlistAction(productIds: string[]): Promise<string[] | null> {
  const scope = await context();
  if (!scope) return null;
  return mergeWishlist(scope, Array.isArray(productIds) ? productIds : []);
}

/** The account's list, for a browser that needs to re-read it. */
export async function readWishlistAction(): Promise<string[] | null> {
  const scope = await context();
  if (!scope) return null;
  return listWishlist(scope);
}
