'use client';

/*
 * Turns bag and wishlist changes into shopping events.
 *
 * Observes the stores rather than editing them: cart-store.ts stays the only
 * file that knows where a cart is kept, and every way an item gets in or out
 * (card, PDP, quick view, undo toast, save-for-later) is covered without
 * each call site remembering to emit.
 *
 * The first update after a store rehydrates is the saved bag being restored,
 * not the shopper doing anything, so it is ignored.
 */
import * as React from 'react';
import { useCartStore } from './stores/cart-store';
import { useWishlistStore } from './stores/wishlist-store';
import { SHOPPING_EVENTS, trackShoppingEvent, type ShoppingEvent } from './shopping-events';

type ProductEventName =
  | typeof SHOPPING_EVENTS.addedToCart
  | typeof SHOPPING_EVENTS.removedFromCart
  | typeof SHOPPING_EVENTS.wishlistAdded
  | typeof SHOPPING_EVENTS.wishlistRemoved;

/** Emit added/removed events for the difference between two id lists. */
export function diffProductIds(
  previous: string[],
  next: string[],
  added: ProductEventName,
  removed: ProductEventName,
): ShoppingEvent[] {
  const before = new Set(previous);
  const after = new Set(next);
  return [
    ...[...after].filter((id) => !before.has(id)).map((productId) => ({ name: added, productId })),
    ...[...before].filter((id) => !after.has(id)).map((productId) => ({ name: removed, productId })),
  ];
}

export function useShoppingEventBridge(): void {
  React.useEffect(() => {
    const offCart = useCartStore.subscribe((state, previous) => {
      if (!previous.hydrated || state.items === previous.items) return;
      diffProductIds(
        previous.items.map((i) => i.productId),
        state.items.map((i) => i.productId),
        SHOPPING_EVENTS.addedToCart,
        SHOPPING_EVENTS.removedFromCart,
      ).forEach(trackShoppingEvent);
    });

    const offWishlist = useWishlistStore.subscribe((state, previous) => {
      if (!previous.hydrated || state.items === previous.items) return;
      diffProductIds(
        previous.items.map((i) => i.productId),
        state.items.map((i) => i.productId),
        SHOPPING_EVENTS.wishlistAdded,
        SHOPPING_EVENTS.wishlistRemoved,
      ).forEach(trackShoppingEvent);
    });

    return () => {
      offCart();
      offWishlist();
    };
  }, []);
}
