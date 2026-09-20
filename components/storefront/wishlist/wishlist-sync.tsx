'use client';

/*
 * Reconciles the browser's saved list with the account's, once per load.
 *
 * Four cases, and the rules that decide them:
 *
 *   guest, always been a guest      nothing to do — the browser IS the list.
 *   guest now, account before       someone signed out. Clear. On a shared
 *                                   device the next person must not find the
 *                                   last one's saves sitting there.
 *   signed in, was a guest          MERGE. Their guest saves fold into the
 *                                   account and nothing is lost — a shopper
 *                                   who loses saves by signing in learns not
 *                                   to sign in.
 *   signed in, same account         adopt the server's list. It is the real
 *                                   one; this browser's copy may be stale or
 *                                   may be missing a write that failed.
 *
 * Mounted once in the storefront layout, renders nothing, and runs after
 * hydration — before that the store's contents are not yet known.
 */
import * as React from 'react';
import { useWishlistStore } from '@/lib/storefront/stores/wishlist-store';
import { mergeWishlistAction } from '@/features/shop-account/wishlist-actions';
import { useShopper } from '@/lib/storefront/context';

export function WishlistSync({ serverItems }: { serverItems: { productId: string; slug: string }[] }) {
  const shopper = useShopper();
  const hydrated = useWishlistStore((s) => s.hydrated);

  /* The server list is a fresh render's worth of truth; keyed on its
   * contents so a change between navigations is picked up, but not so that
   * re-renders re-run the merge. */
  const serverKey = serverItems.map((i) => i.productId).join(',');
  const ran = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!hydrated) return;

    const signature = `${shopper?.id ?? 'guest'}:${serverKey}`;
    if (ran.current === signature) return;
    ran.current = signature;

    const store = useWishlistStore.getState();

    if (!shopper) {
      if (store.accountId) store.reset();
      return;
    }

    const asEntries = (ids: string[]) => {
      const bySlug = new Map(serverItems.map((i) => [i.productId, i.slug]));
      const local = new Map(store.items.map((i) => [i.productId, i.slug]));
      return ids.map((productId, index) => ({
        productId,
        slug: bySlug.get(productId) ?? local.get(productId) ?? '',
        // Order comes from the server (newest first); the timestamp only has
        // to preserve it.
        addedAt: Date.now() - index,
      }));
    };

    const guestSaves = store.accountId === null ? store.items.map((i) => i.productId) : [];

    if (guestSaves.length > 0) {
      void mergeWishlistAction(guestSaves)
        .then((merged) => {
          if (merged) store.adopt(asEntries(merged), shopper.id);
        })
        .catch(() => {
          /* offline: the browser keeps what it has and the next load tries again */
        });
      return;
    }

    store.adopt(asEntries(serverItems.map((i) => i.productId)), shopper.id);
  }, [hydrated, shopper, serverItems, serverKey]);

  return null;
}
