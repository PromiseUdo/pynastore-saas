'use client';

/*
 * Quick view — a short form of the product page, opened from a card.
 *
 * It deliberately reuses the product page's pieces (<VariantPicker>,
 * <QuantityStepper>, the variant-selection rules) rather than its own
 * look-alikes, so the two cannot drift in style or in what they let a
 * shopper buy.
 */
import * as React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { DialogRoot, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { RatingStars } from '@/components/storefront/common/rating-stars';
import { VariantPicker } from './variant-picker';
import { QuantityStepper } from './quantity-stepper';
import type { Product } from '@/lib/storefront/types';
import { useStorefront } from '@/lib/storefront/context';
import { discountPercent, formatMoney } from '@/lib/storefront/format';
import { useHydrated } from '@/lib/storefront/context';
import { useUIStore } from '@/lib/storefront/stores/ui-store';
import { useCartActions } from '@/lib/storefront/use-cart-actions';
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

/** Matches the product page: below this, say how few are left. */
const LOW_STOCK = 8;

export function QuickViewModal() {
  // The suggestions/product endpoints sit outside the tenant rewrite, so the
  // request has to name its store (see the route's header comment).
  const { org } = useStorefront();
  const slug = useUIStore((s) => s.quickViewSlug);
  const close = useUIStore((s) => s.closeQuickView);
  const [product, setProduct] = React.useState<Product | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!slug) {
      setProduct(null);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    fetch(`/api/storefront/product/${slug}?store=${encodeURIComponent(org.slug)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { product: Product }) => setProduct(d.product))
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [slug]);

  return (
    <DialogRoot open={Boolean(slug)} onOpenChange={(o) => !o && close()}>
      {/* Scrolls inside itself on a short phone screen instead of running
        * off the bottom with the Add button out of reach. */}
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto rounded-2xl p-0 sm:rounded-[1.5rem]"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">{product ? product.name : 'Product quick view'}</DialogTitle>
        {loading && !product ? (
          <div className="grid gap-5 p-4 sm:grid-cols-2 sm:gap-8 sm:p-6">
            <div className="aspect-square animate-pulse rounded-2xl bg-muted" />
            <div className="space-y-3">
              <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
              <div className="h-6 w-3/4 animate-pulse rounded bg-muted" />
              <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          </div>
        ) : product ? (
          <QuickViewBody product={product} onClose={close} />
        ) : (
          <div className="p-10 text-center text-sm text-muted-foreground">Couldn’t load this product.</div>
        )}
      </DialogContent>
    </DialogRoot>
  );
}

function QuickViewBody({ product, onClose }: { product: Product; onClose: () => void }) {
  const hydrated = useHydrated();
  const { addToCart } = useCartActions();
  const [selection, setSelection] = React.useState<Selection>(() => initialSelection(product));
  const [quantity, setQuantity] = React.useState(1);
  const [imageIndex, setImageIndex] = React.useState(0);

  /* The same selection rules as the product page (lib/storefront/
   * variant-selection.ts), so a size that is sold out there is sold out
   * here, and the price and stock line always describe the same variant. */
  const variant = resolveVariant(product, selection);
  const stock = maxQuantity(product, variant);
  const price = selectedPrice(product, variant);
  const compareAt = selectedCompareAt(product, variant);
  const pct = discountPercent(price, compareAt);
  const addable = canAddToCart(product, variant);
  const missing = missingOptionLabels(product, selection);

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
      if (missing.length) toast.error(`Please select a ${missing.join(' and ')}.`);
      return;
    }
    if (addToCart(product, { variant: variant ?? undefined, quantity })) onClose();
  };

  const images = product.images.slice(0, 6);
  const active = images[Math.min(imageIndex, images.length - 1)];

  return (
    <div className="grid gap-5 p-4 sm:grid-cols-2 sm:gap-8 sm:p-6">
      <div className="min-w-0">
        <div className="relative aspect-square overflow-hidden rounded-2xl bg-tile">
          {active && (
            <Image
              src={active.url}
              alt={active.alt || product.name}
              fill
              sizes="(max-width: 640px) 90vw, 22rem"
              className="object-cover"
            />
          )}
          {pct != null && (
            <span className="absolute left-3 top-3 rounded-full bg-highlight px-3 py-1 text-xs font-bold text-highlight-foreground">
              −{pct}%
            </span>
          )}
        </div>
        {images.length > 1 && (
          <div
            className="sf-no-scrollbar mt-3 flex gap-2 overflow-x-auto p-0.5"
            role="tablist"
            aria-label={`${product.name} images`}
          >
            {images.map((image, i) => (
              <button
                key={image.id}
                type="button"
                role="tab"
                aria-selected={i === imageIndex}
                aria-label={`Show image ${i + 1} of ${images.length}`}
                onClick={() => setImageIndex(i)}
                className={cn(
                  'relative size-14 shrink-0 overflow-hidden rounded-xl bg-tile ring-offset-2 ring-offset-card transition',
                  i === imageIndex ? 'ring-2 ring-brand' : 'opacity-70 hover:opacity-100',
                )}
              >
                <Image src={image.url} alt="" fill sizes="56px" className="object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-col">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal">
          {product.brandName}
        </p>
        {/* pr-8 keeps a long name clear of the dialog's close button */}
        <h2 className="mt-2 pr-8 font-display text-xl leading-tight sm:text-2xl">{product.name}</h2>

        <div className="mt-2 flex items-center gap-2 text-sm">
          <RatingStars value={product.rating.average} size={15} showValue />
          <span className="text-muted-foreground">
            ({product.rating.count.toLocaleString()})
          </span>
        </div>

        <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-2xl font-bold text-price">
            {formatMoney(price, product.currency)}
          </span>
          {compareAt != null && (
            <>
              <span className="text-base text-muted-foreground line-through">
                {formatMoney(compareAt, product.currency)}
              </span>
              <span className="rounded-full bg-sale/15 px-2.5 py-1 text-xs font-bold text-sale">
                {pct}% off
              </span>
            </>
          )}
        </div>

        <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
          {product.shortDescription}
        </p>

        {product.options.length > 0 && (
          <div className="mt-5 border-t pt-5">
            <VariantPicker product={product} selection={selection} onSelect={onSelect} />
          </div>
        )}

        <p className="mt-4 text-sm" aria-live="polite">
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

        <div className="mt-4 flex items-center gap-3">
          <QuantityStepper value={quantity} max={stock} onChange={setQuantity} className="shrink-0" />
          <button
            type="button"
            onClick={onAdd}
            disabled={!addable && !missing.length}
            className={cn(
              'h-12 min-w-0 flex-1 rounded-full bg-brand px-4 text-sm font-semibold text-primary-foreground',
              'transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-muted',
              'disabled:text-muted-foreground',
            )}
          >
            {missing.length ? 'Select options' : stock <= 0 ? 'Out of stock' : 'Add to bag'}
          </button>
        </div>

        {hydrated && missing.length > 0 && (
          <p className="mt-2 text-sm font-medium text-sale" role="status">
            Please select a {missing.join(' and ')}.
          </p>
        )}

        <Link
          href={`/products/${product.slug}`}
          onClick={onClose}
          className="group mt-5 inline-flex items-center gap-1.5 self-start text-sm font-semibold text-teal underline-offset-4 hover:underline"
        >
          View full details
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </div>
  );
}
