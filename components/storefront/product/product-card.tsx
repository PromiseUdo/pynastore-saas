'use client';

/*
 * Product card — warm retail.
 *
 * Deliberately ONE action. The previous card offered "add to bag" and "buy
 * now" side by side, which makes a shopper stop and choose before they've
 * even opened the product. A single full-width primary is faster to scan
 * across a rail of six and leaves the card quiet.
 *
 * The image sits on `--tile`, which stays light in both themes: catalogue
 * photography is overwhelmingly shot on white, and floating those cut-outs
 * on an ink card looks broken.
 */
import * as React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { toast } from 'sonner';
import { Eye, Heart, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Product } from '@/lib/storefront/types';
import { useCartActions } from '@/lib/storefront/use-cart-actions';
import { useWishlistStore } from '@/lib/storefront/stores/wishlist-store';
import { useUIStore } from '@/lib/storefront/stores/ui-store';
import { useHydrated } from '@/lib/storefront/context';
import { discountPercent, formatCompact, formatMoney } from '@/lib/storefront/format';

export function ProductCard({
  product,
  priority,
  className,
}: {
  product: Product;
  priority?: boolean;
  className?: string;
}) {
  const hydrated = useHydrated();
  const { addToCart } = useCartActions();

  const wishlisted = useWishlistStore((s) => s.items.some((i) => i.productId === product.id));
  const toggleWishlist = useWishlistStore((s) => s.toggle);
  const setQuickView = useUIStore((s) => s.openQuickView);

  const primary = product.images[0]?.url ?? '';
  const secondary = product.images[1]?.url ?? primary;
  const pct = discountPercent(product.priceFrom, product.compareAtPrice);
  const href = `/products/${product.slug}`;
  const soldOut = hydrated && !product.inStock;

  const onWishlist = (e: React.MouseEvent) => {
    e.preventDefault();
    const added = toggleWishlist({ productId: product.id, slug: product.slug });
    toast[added ? 'success' : 'message'](added ? 'Saved to your wishlist' : 'Removed from wishlist');
  };
  const onQuickView = (e: React.MouseEvent) => {
    e.preventDefault();
    setQuickView(product.slug);
  };
  /*
   * One action, two destinations.
   *
   * A card has no room for a variant picker and no business guessing: a
   * product with options opens quick view, which already owns that UI, and
   * only a single-variant product goes straight into the bag. This is why
   * the label changes with the product — "Choose options" is a promise the
   * card can keep.
   */
  const needsOptions = product.options.length > 0;
  const onAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    if (needsOptions) {
      setQuickView(product.slug);
      return;
    }
    addToCart(product, { openDrawer: false });
  };

  return (
    <article className={cn('group/card flex h-full flex-col', className)}>
      <div className="relative overflow-hidden rounded-2xl bg-tile">
        <Link href={href} aria-label={product.name} className="block">
          <span className="relative block aspect-square">
            <Image
              src={primary}
              alt={product.name}
              fill
              priority={priority}
              sizes="(max-width:640px) 50vw, (max-width:1024px) 33vw, 22vw"
              className={cn(
                'object-cover transition-[opacity,transform] duration-700 ease-out',
                'group-hover/card:scale-[1.04]',
                secondary !== primary && 'group-hover/card:opacity-0',
              )}
            />
            {secondary !== primary && (
              <Image
                src={secondary}
                alt=""
                fill
                sizes="(max-width:640px) 50vw, (max-width:1024px) 33vw, 22vw"
                className="scale-[1.04] object-cover opacity-0 transition-opacity duration-700 ease-out group-hover/card:opacity-100"
              />
            )}
          </span>
        </Link>

        {/* badges */}
        <div className="pointer-events-none absolute left-3 top-3 flex flex-col items-start gap-1.5">
          {pct != null && (
            <span className="rounded-full bg-highlight px-2.5 py-1 text-[11px] font-bold text-highlight-foreground">
              −{pct}%
            </span>
          )}
          {product.tags.includes('new') && (
            <span className="rounded-full bg-brand px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-primary-foreground">
              New
            </span>
          )}
          {soldOut && (
            <span className="rounded-full bg-muted-foreground px-2.5 py-1 text-[11px] font-bold text-background">
              Sold out
            </span>
          )}
        </div>

        {/* Wishlist is always reachable; quick view is a pointer nicety and is
          * hidden from touch, where the whole card is already one tap away. */}
        <button
          type="button"
          onClick={onWishlist}
          aria-label={wishlisted ? 'Remove from wishlist' : 'Save to wishlist'}
          aria-pressed={hydrated && wishlisted}
          className={cn(
            'absolute right-3 top-3 flex size-9 items-center justify-center rounded-full backdrop-blur transition',
            'bg-white/85 text-neutral-800 hover:bg-white',
            hydrated && wishlisted && 'bg-brand text-primary-foreground hover:bg-brand',
          )}
        >
          <Heart className={cn('size-4', hydrated && wishlisted && 'fill-current')} />
        </button>

        <button
          type="button"
          onClick={onQuickView}
          className="absolute inset-x-3 bottom-3 hidden translate-y-2 items-center justify-center gap-2 rounded-full bg-white/90 py-2.5 text-xs font-semibold text-neutral-900 opacity-0 backdrop-blur transition-all duration-200 hover:bg-white group-hover/card:translate-y-0 group-hover/card:opacity-100 lg:flex"
        >
          <Eye className="size-3.5" />
          Quick view
        </button>
      </div>

      <div className="flex flex-1 flex-col px-0.5 pt-3.5">
        <Link
          href={href}
          className="line-clamp-2 text-[0.9375rem] font-semibold leading-snug transition-colors hover:text-teal"
        >
          {product.name}
        </Link>

{/* Social proof only when there is some. A store with no reviews and no
          * sales yet would otherwise advertise "0.0 · 0 sold" on every card. */}
        {(product.rating.count > 0 || product.soldCount > 0) && (
          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            {product.rating.count > 0 && (
              <>
                <Star className="size-3.5 shrink-0 fill-rating text-rating" />
                <span className="font-semibold text-foreground">{product.rating.average.toFixed(1)}</span>
              </>
            )}
            {product.rating.count > 0 && product.soldCount > 0 && <span aria-hidden>·</span>}
            {product.soldCount > 0 && <span>{formatCompact(product.soldCount)} sold</span>}
          </div>
        )}

        {/* `mt-auto` pins price + action to the bottom so cards with one-line
          * and two-line titles still line up across a row. */}
        <div className="mt-auto pt-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-lg font-bold text-price">
              {formatMoney(product.priceFrom, product.currency)}
            </span>
            {pct != null && (
              <span className="text-sm text-muted-foreground line-through">
                {formatMoney(product.compareAtPrice!, product.currency)}
              </span>
            )}
          </div>

          <button
            onClick={onAdd}
            disabled={soldOut}
            aria-label={
              soldOut
                ? `${product.name} is sold out`
                : needsOptions
                  ? `Choose options for ${product.name}`
                  : `Add ${product.name} to bag`
            }
            className="mt-3 h-11 w-full rounded-full border border-brand bg-transparent text-sm font-semibold text-brand transition-colors hover:bg-brand hover:text-primary-foreground disabled:cursor-not-allowed disabled:border-border disabled:text-muted-foreground disabled:hover:bg-transparent"
          >
            {soldOut ? 'Sold out' : needsOptions ? 'Choose options' : 'Add to bag'}
          </button>
        </div>
      </div>
    </article>
  );
}

export function ProductCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col', className)}>
      <div className="aspect-square animate-pulse rounded-2xl bg-muted" />
      <div className="space-y-2 pt-3.5">
        <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
        <div className="h-5 w-24 animate-pulse rounded bg-muted" />
        <div className="h-11 animate-pulse rounded-full bg-muted" />
      </div>
    </div>
  );
}
