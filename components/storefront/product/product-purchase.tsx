'use client';

/*
 * The buying half of the product page: gallery, identity, price, variants,
 * quantity and the actions.
 *
 * This is the ONLY client component above the fold, and it is a client
 * component for one reason: choosing a variant changes the price, the stock
 * line and the photograph at once, so those pieces have to share state.
 * Everything below it on the page — description, specs, reviews, Q&A, every
 * recommendation rail — stays a Server Component.
 *
 * Static server-rendered blocks (the delivery panel) arrive as props rather
 * than being rebuilt here, so they cost no client JavaScript.
 *
 * The cart is NOT implemented here. `useCartActions()` (Phase 1) is the
 * integration boundary: it takes product + variant + quantity and owns
 * everything after that.
 */
import * as React from 'react';
import { Check, Heart, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { RatingStars } from '@/components/storefront/common/rating-stars';
import { ProductGallery } from './product-gallery';
import { VariantPicker } from './variant-picker';
import { QuantityStepper } from './quantity-stepper';
import type { Product } from '@/lib/storefront/types';
import { discountPercent, formatCompact, formatMoney } from '@/lib/storefront/format';
import { useCartActions } from '@/lib/storefront/use-cart-actions';
import { useWishlistStore } from '@/lib/storefront/stores/wishlist-store';
import { useRecentlyViewedStore } from '@/lib/storefront/stores/recently-viewed-store';
import { SHOPPING_EVENTS, trackShoppingEvent } from '@/lib/storefront/shopping-events';
import { useStorefront, useHydrated } from '@/lib/storefront/context';
import {
  canAddToCart,
  clampQuantity,
  imageIndexForSelection,
  initialSelection,
  maxQuantity,
  missingOptionLabels,
  resolveVariant,
  selectValue,
  selectedCompareAt,
  selectedPrice,
  type Selection,
} from '@/lib/storefront/variant-selection';

/** Below this, we say how few are left — above it, saying so is just theatre. */
const LOW_STOCK = 8;

export function ProductPurchase({
  product,
  deliveryPanel,
  sizeGuideHref = null,
}: {
  product: Product;
  /** server-rendered delivery block */
  deliveryPanel?: React.ReactNode;
  /** the merchant's published size guide, when there is one */
  sizeGuideHref?: string | null;
}) {
  const hydrated = useHydrated();
  const { addToCart } = useCartActions();

  const [selection, setSelection] = React.useState<Selection>(() => initialSelection(product));
  const [quantity, setQuantity] = React.useState(1);
  const [imageIndex, setImageIndex] = React.useState(0);
  const [adding, setAdding] = React.useState(false);

  const wishlisted = useWishlistStore((s) => s.items.some((i) => i.productId === product.id));
  const toggleWishlist = useWishlistStore((s) => s.toggle);
  const visit = useRecentlyViewedStore((s) => s.visit);

  /* Record the view once per product. Client-side only and unauthenticated —
   * the ids never leave the browser except as a lookup (see
   * app/api/storefront/products/route.ts). */
  React.useEffect(() => {
    visit(product.id);
    trackShoppingEvent({ name: SHOPPING_EVENTS.productViewed, productId: product.id });
  }, [product.id, visit]);

  // A different product through the same component (a rail click) resets.
  React.useEffect(() => {
    setSelection(initialSelection(product));
    setQuantity(1);
    setImageIndex(0);
  }, [product]);

  const variant = resolveVariant(product, selection);
  const stock = maxQuantity(product, variant);
  const price = selectedPrice(product, variant);
  const compareAt = selectedCompareAt(product, variant);
  const pct = discountPercent(price, compareAt);
  const addable = canAddToCart(product, variant);
  /* What's still unanswered, in words: a greyed-out button tells a shopper
   * they can't buy, not that they forgot to pick a size. */
  const missing = missingOptionLabels(product, selection);

  // Keep the quantity legal when the variant (and its stock) changes.
  React.useEffect(() => {
    setQuantity((q) => clampQuantity(q, stock));
  }, [stock]);

  const onSelect = (optionId: string, valueId: string) => {
    const next = selectValue(product, selection, optionId, valueId);
    setSelection(next);
    const index = imageIndexForSelection(product, next);
    if (index != null) setImageIndex(index);
  };

  const onAdd = () => {
    if (!addable) {
      // Reachable from the sticky bar, where the hint under the desktop
      // button isn't on screen.
      if (missing.length) toast.error(`Please select a ${missing.join(' and ')}.`);
      return;
    }
    setAdding(true);
    // The cart store is synchronous today; the flag exists so the button has
    // a pending state the moment this call becomes a request.
    addToCart(product, { variant: variant ?? undefined, quantity, openDrawer: false });
    setAdding(false);
  };

  const onWishlist = () => {
    const added = toggleWishlist({ productId: product.id, slug: product.slug });
    toast[added ? 'success' : 'message'](added ? 'Saved to your wishlist' : 'Removed from wishlist');
  };

  return (
    <>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_26rem] lg:gap-12 xl:grid-cols-[minmax(0,1fr)_28rem]">
        <ProductGallery
          images={product.images}
          productName={product.name}
          activeIndex={imageIndex}
          onActiveChange={setImageIndex}
          badge={
            <>
              {pct != null && (
                <span className="rounded-full bg-highlight px-3 py-1 text-xs font-bold text-highlight-foreground">
                  −{pct}%
                </span>
              )}
              {hydrated && !product.inStock && (
                <span className="rounded-full bg-muted-foreground px-3 py-1 text-xs font-bold text-background">
                  Sold out
                </span>
              )}
            </>
          }
        />

        {/* ── identity, price, choices, actions ───────────────────── */}
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal">
            {product.brandName}
          </p>
          <h1 className="mt-2 font-display text-2xl leading-tight sm:text-3xl">{product.name}</h1>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
            {product.rating.count > 0 && (
              <a href="#reviews" className="inline-flex items-center gap-2 hover:underline">
                <RatingStars value={product.rating.average} size={16} showValue />
                <span className="text-muted-foreground">
                  ({product.rating.count.toLocaleString()} reviews)
                </span>
              </a>
            )}
            {product.soldCount > 0 && (
              <>
                <span aria-hidden className="text-muted-foreground">
                  ·
                </span>
                <span className="text-muted-foreground">
                  {formatCompact(product.soldCount)} sold
                </span>
              </>
            )}
          </div>

          {/* Price is the loudest thing in this column, deliberately. */}
          <div className="mt-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-3xl font-bold text-price sm:text-4xl">
              {formatMoney(price, product.currency)}
            </span>
            {compareAt != null && (
              <>
                <span className="text-lg text-muted-foreground line-through">
                  {formatMoney(compareAt, product.currency)}
                </span>
                <span className="rounded-full bg-sale/15 px-2.5 py-1 text-xs font-bold text-sale">
                  {pct}% off
                </span>
              </>
            )}
          </div>

          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            {product.shortDescription}
          </p>

          <div className="mt-6 border-t pt-6">
            <VariantPicker product={product} selection={selection} onSelect={onSelect} sizeGuideHref={sizeGuideHref} />
          </div>

          {/* Availability. Rendered only after hydration, because the honest
            * answer depends on the selected variant. */}
          <p className="mt-5 text-sm" aria-live="polite">
            {!hydrated ? null : stock <= 0 ? (
              <span className="font-semibold text-muted-foreground">Out of stock</span>
            ) : stock <= LOW_STOCK ? (
              <span className="font-semibold text-sale">Only {stock} left</span>
            ) : (
              <span className="inline-flex items-center gap-1.5 font-semibold text-success">
                <ShieldCheck className="size-4" /> In stock
              </span>
            )}
          </p>

          {/* One row at every width: the stepper keeps its size and the
            * button takes what is left. A minimum width here used to push the
            * button onto its own line on 360–375px phones. */}
          <div className="mt-5 flex items-center gap-3">
            <QuantityStepper value={quantity} max={stock} onChange={setQuantity} className="shrink-0" />

            <button
              type="button"
              onClick={onAdd}
              disabled={!addable || adding}
              data-pdp-add
              className={cn(
                'h-12 min-w-0 flex-1 rounded-full bg-brand px-4 text-sm font-semibold text-primary-foreground sm:px-6',
                'transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-muted',
                'disabled:text-muted-foreground',
              )}
            >
              {adding ? (
                <Loader2 className="mx-auto size-4 animate-spin" />
              ) : !addable && product.options.length ? (
                'Select options'
              ) : stock <= 0 ? (
                'Out of stock'
              ) : (
                'Add to bag'
              )}
            </button>
          </div>

          {hydrated && missing.length > 0 && (
            <p className="mt-2 text-sm font-medium text-sale" role="status">
              Please select a {missing.join(' and ')}.
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onWishlist}
              aria-pressed={hydrated && wishlisted}
              className={cn(
                'inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors',
                hydrated && wishlisted
                  ? 'border-brand text-brand'
                  : 'hover:border-brand hover:text-brand',
              )}
            >
              <Heart className={cn('size-4', hydrated && wishlisted && 'fill-current')} />
              {hydrated && wishlisted ? 'Saved' : 'Save'}
            </button>

          </div>

          {product.highlights.length > 0 && (
            <ul className="mt-6 space-y-2 text-sm">
              {product.highlights.map((highlight) => (
                <li key={highlight} className="flex items-start gap-2.5 text-muted-foreground">
                  <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-teal" />
                  {highlight}
                </li>
              ))}
            </ul>
          )}

          {deliveryPanel}
        </div>
      </div>

      <StickyBuyBar
        product={product}
        price={price}
        stock={stock}
        addable={addable}
        needsOptions={missing.length > 0}
        onAdd={onAdd}
      />
    </>
  );
}

/*
 * The phone purchase bar.
 *
 * Appears only once the real button has scrolled away, so it never
 * double-renders the same action, and sits above the native tab bar when the
 * storefront is running inside the mobile app (where that bar exists).
 */
function StickyBuyBar({
  product,
  price,
  stock,
  addable,
  needsOptions,
  onAdd,
}: {
  product: Product;
  price: number;
  stock: number;
  addable: boolean;
  /** options still unchosen — the bar stays tappable so it can say which */
  needsOptions: boolean;
  onAdd: () => void;
}) {
  const { isMobileRuntime } = useStorefront();
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const target = document.querySelector('[data-pdp-add]');
    if (!target) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(!entry.isIntersecting && entry.boundingClientRect.top < 0),
      { threshold: 0 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  /* Tell fixed page furniture (the back-to-top button) that the bottom of
   * the screen is taken, so it can move up rather than sit on this button. */
  React.useEffect(() => {
    const root = document.documentElement;
    if (visible) root.setAttribute('data-sticky-buy-bar', isMobileRuntime ? 'app' : 'web');
    else root.removeAttribute('data-sticky-buy-bar');
    return () => root.removeAttribute('data-sticky-buy-bar');
  }, [visible, isMobileRuntime]);

  if (!visible) return null;

  return (
    <div
      className={cn(
        'fixed inset-x-0 z-20 flex items-center gap-3 border-t bg-background/95 px-5 pt-3 backdrop-blur lg:hidden',
        // In the app the tab bar below already absorbs the home indicator.
        isMobileRuntime ? 'pb-3' : 'pb-[max(0.75rem,env(safe-area-inset-bottom))]',
        isMobileRuntime ? 'bottom-[3.5rem]' : 'bottom-0',
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-muted-foreground">{product.name}</p>
        <p className="text-base font-bold text-price">{formatMoney(price, product.currency)}</p>
      </div>
      <button
        type="button"
        onClick={onAdd}
        disabled={!addable && !needsOptions}
        className="h-12 shrink-0 rounded-full bg-brand px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand-hover disabled:bg-muted disabled:text-muted-foreground"
      >
        {needsOptions ? 'Select options' : stock <= 0 ? 'Out of stock' : 'Add to bag'}
      </button>
    </div>
  );
}
