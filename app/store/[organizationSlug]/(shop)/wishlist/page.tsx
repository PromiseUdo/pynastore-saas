/*
 * /wishlist
 *
 * The page the heart in the header has always pointed at.
 *
 * It needs NO account: a guest's saves live in their browser and this page
 * shows them. For a signed-in shopper the same page shows the account's
 * list, because the store it reads from has already been reconciled with the
 * server (components/storefront/wishlist/wishlist-sync.tsx).
 *
 * NOT INDEXED. A wishlist is one person's list and belongs in no search
 * result, the same way /cart and /checkout don't.
 */
import type { Metadata } from 'next';
import { WishlistView } from '@/components/storefront/wishlist/wishlist-view';

export const metadata: Metadata = {
  title: 'Saved items',
  robots: { index: false, follow: false },
};

export default function WishlistPage() {
  return (
    <div className="sf-container py-8 sm:py-12">
      <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">Saved items</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Everything you&apos;ve hearted, at today&apos;s prices.
      </p>

      <div className="mt-8">
        <WishlistView />
      </div>
    </div>
  );
}
