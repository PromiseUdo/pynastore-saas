'use client';

/*
 * The saved list, on its own page.
 *
 * It renders from the wishlist store, which by this point has already been
 * reconciled with the account (see ./wishlist-sync.tsx) — so this component
 * never has to know whether the shopper is signed in to show the right
 * things. It resolves the ids through the same /api/storefront/products
 * endpoint the recently-viewed rail uses: one request, today's prices,
 * today's stock. A saved item showing last month's price would be the one
 * lie a wishlist must not tell.
 *
 * Products come back as ordinary <ProductCard>s, which already carry the
 * heart (here it removes), quick view and add-to-bag. A saved item behaves
 * exactly like the same product anywhere else on the store.
 *
 * PRUNING. Anything the catalogue no longer returns — delisted, deleted,
 * gone — is dropped from the store, so the header badge can never count
 * things that aren't there any more.
 */
import * as React from 'react';
import Link from 'next/link';
import { Heart } from 'lucide-react';
import { ProductCard, ProductCardSkeleton } from '@/components/storefront/product/product-card';
import { useStorefront, useShopper } from '@/lib/storefront/context';
import { useWishlistStore } from '@/lib/storefront/stores/wishlist-store';
import type { Product } from '@/lib/storefront/types';

export function WishlistView() {
  const { org } = useStorefront();
  const shopper = useShopper();
  const hydrated = useWishlistStore((s) => s.hydrated);
  const items = useWishlistStore((s) => s.items);

  const [products, setProducts] = React.useState<Product[] | null>(null);

  const ids = items.map((item) => item.productId);
  const key = ids.join(',');

  React.useEffect(() => {
    if (!hydrated) return;
    if (!key) {
      setProducts([]);
      return;
    }

    const controller = new AbortController();
    fetch(
      `/api/storefront/products?ids=${encodeURIComponent(key)}&store=${encodeURIComponent(org.slug)}`,
      { signal: controller.signal },
    )
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { products: Product[] } | null) => {
        if (!data) return;
        setProducts(data.products ?? []);

        /* Drop saves the catalogue no longer knows about. Done here rather
         * than in the store so it happens once, where the answer is known. */
        const alive = new Set((data.products ?? []).map((product) => product.id));
        const store = useWishlistStore.getState();
        for (const id of key.split(',')) {
          if (!alive.has(id)) store.remove(id);
        }
      })
      .catch(() => {
        /* aborted or offline — keep showing whatever we had */
      });

    return () => controller.abort();
  }, [hydrated, key, org.slug]);

  if (!hydrated || products === null) {
    return (
      <div className="grid grid-cols-2 gap-x-4 gap-y-8 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="rounded-3xl border border-border bg-card px-6 py-14 text-center">
        <Heart className="mx-auto size-8 text-muted-foreground" aria-hidden />
        <h2 className="mt-4 font-display text-xl font-semibold">Nothing saved yet</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          Tap the heart on anything you like and it waits for you here — with whatever it costs on
          the day you come back.
        </p>
        <Link
          href="/products"
          className="mt-6 inline-flex h-12 items-center rounded-full bg-brand px-7 text-base font-semibold text-primary-foreground transition-colors hover:bg-brand-hover"
        >
          Start browsing
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {products.length} {products.length === 1 ? 'item' : 'items'} saved
        </p>

        {/* Said once, quietly, to the people it affects — not a wall in
          * front of a page that already works. */}
        {!shopper && (
          <p className="text-sm text-muted-foreground">
            Saved on this device.{' '}
            <Link
              href="/account/sign-in?next=%2Fwishlist"
              className="font-semibold text-brand underline underline-offset-4"
            >
              Sign in
            </Link>{' '}
            to keep them.
          </p>
        )}
      </div>

      <ul className="grid grid-cols-2 gap-x-4 gap-y-8 lg:grid-cols-4">
        {products.map((product) => (
          <li key={product.id}>
            <ProductCard product={product} />
          </li>
        ))}
      </ul>
    </>
  );
}
