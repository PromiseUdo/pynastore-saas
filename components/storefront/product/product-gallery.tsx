'use client';

/*
 * Product gallery.
 *
 * Two genuinely different interactions from one component, because the
 * right gesture differs by device:
 *
 *  - Phone: a full-bleed snap-scrolling strip with a counter. Swiping is
 *    what people already do with product photos; a 44px thumbnail grid under
 *    a small image wastes the only screen that matters.
 *  - Pointer: a large still with a thumbnail column beside it, arrows on
 *    hover, and click-to-zoom into a dialog.
 *
 * No carousel library: a CSS scroll-snap track plus `scrollIntoView` does
 * everything here, works before hydration, and keeps the page's JavaScript
 * budget for the parts that actually need it. (Embla is in the bundle for
 * the homepage rails, but those animate between cards; this doesn't.)
 *
 * `activeIndex` is controlled by the parent so choosing a colour can move
 * the gallery to that colour's photograph.
 */
import * as React from 'react';
import Image from 'next/image';
import { ChevronLeft, ChevronRight, Expand, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DialogRoot, DialogContent, DialogTitle } from '@/components/ui/dialog';
import type { ProductImage } from '@/lib/storefront/types';

export function ProductGallery({
  images,
  productName,
  activeIndex,
  onActiveChange,
  badge,
}: {
  images: ProductImage[];
  productName: string;
  activeIndex: number;
  onActiveChange: (index: number) => void;
  /** discount / sold-out pill, rendered over the image */
  badge?: React.ReactNode;
}) {
  const [zoomed, setZoomed] = React.useState(false);
  const trackRef = React.useRef<HTMLDivElement>(null);
  /* Set while we are scrolling the strip ourselves, so the scroll handler
   * doesn't fight the parent's choice and snap back. */
  const programmatic = React.useRef(false);

  const count = images.length;
  const safeIndex = Math.min(Math.max(0, activeIndex), Math.max(0, count - 1));
  const active = images[safeIndex];

  const go = React.useCallback(
    (index: number) => onActiveChange((index + count) % count),
    [count, onActiveChange],
  );

  /* Keep the phone strip in step when the index changes from outside it
   * (a colour swatch, an arrow, a thumbnail). */
  React.useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    /* Every slide is exactly one track wide, so its position is arithmetic.
     * (`slide.offsetLeft` is measured from the nearest positioned ancestor,
     * which sits a gutter away from the bleeding track — using it scrolled
     * 20px short and the snap then fought it back after every swipe.) */
    const left = safeIndex * track.clientWidth;
    if (Math.abs(track.scrollLeft - left) < 8) return;

    programmatic.current = true;
    track.scrollTo({ left, behavior: 'smooth' });
    const timer = setTimeout(() => {
      programmatic.current = false;
    }, 400);
    return () => clearTimeout(timer);
  }, [safeIndex]);

  const onScroll = () => {
    const track = trackRef.current;
    if (!track || programmatic.current) return;
    const index = Math.round(track.scrollLeft / track.clientWidth);
    if (index !== safeIndex) onActiveChange(Math.min(Math.max(0, index), count - 1));
  };

  if (!count) {
    return <div className="aspect-square w-full rounded-2xl bg-tile" aria-hidden />;
  }

  return (
    <div className="lg:flex lg:gap-4">
      {/* ── thumbnails (pointer devices) ───────────────────────────── */}
      <div
        className="sf-thin-scrollbar hidden lg:flex lg:max-h-[34rem] lg:w-20 lg:shrink-0 lg:flex-col lg:gap-3 lg:overflow-y-auto"
        role="tablist"
        aria-label={`${productName} images`}
      >
        {images.map((image, i) => (
          <button
            key={image.id}
            type="button"
            role="tab"
            aria-selected={i === safeIndex}
            aria-label={`Show image ${i + 1} of ${count}`}
            onClick={() => onActiveChange(i)}
            className={cn(
              'relative aspect-square w-full shrink-0 overflow-hidden rounded-xl bg-tile ring-offset-2 transition',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              i === safeIndex ? 'ring-2 ring-brand' : 'opacity-70 hover:opacity-100',
            )}
          >
            <Image src={image.url} alt="" fill sizes="80px" className="object-cover" />
          </button>
        ))}
      </div>

      {/* ── main image (pointer devices) ───────────────────────────── */}
      <div className="relative hidden min-w-0 flex-1 lg:block">
        <div className="relative aspect-square overflow-hidden rounded-2xl bg-tile">
          <Image
            src={active.url}
            alt={active.alt || productName}
            fill
            priority
            sizes="(max-width: 1024px) 100vw, 42vw"
            className="object-cover"
          />
          {badge && <div className="absolute left-4 top-4 flex flex-col gap-1.5">{badge}</div>}

          <button
            type="button"
            onClick={() => setZoomed(true)}
            aria-label="Open image full size"
            className="absolute right-4 top-4 flex size-10 items-center justify-center rounded-full bg-white/85 text-neutral-800 backdrop-blur transition hover:bg-white"
          >
            <Expand className="size-4" />
          </button>

          {count > 1 && (
            <>
              <GalleryArrow side="left" onClick={() => go(safeIndex - 1)} />
              <GalleryArrow side="right" onClick={() => go(safeIndex + 1)} />
            </>
          )}
        </div>
      </div>

      {/* ── swipeable strip (phones and tablets) ───────────────────── */}
      <div className="relative lg:hidden">
        <div
          ref={trackRef}
          onScroll={onScroll}
          // On a phone -mx-5 cancels the page gutter so the photography runs
          // edge to edge, which is what makes it read as a gallery rather than
          // a card. From `sm` the gutter is wider and a full-width square
          // would fill a tablet screen, so it becomes a capped, rounded card.
          className="sf-no-scrollbar -mx-5 flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain sm:mx-auto sm:max-w-xl sm:rounded-2xl"
        >
          {images.map((image, i) => (
            <button
              key={image.id}
              type="button"
              onClick={() => setZoomed(true)}
              aria-label={`Open image ${i + 1} of ${count} full size`}
              // w-full, not w-screen: a slide must be exactly one track wide
              // or the snap points and the counter drift apart.
              className="relative aspect-square w-full shrink-0 snap-center snap-always bg-tile"
            >
              <Image
                src={image.url}
                alt={i === 0 ? image.alt || productName : ''}
                fill
                priority={i === 0}
                sizes="(max-width: 640px) 100vw, 36rem"
                className="object-cover"
                draggable={false}
              />
            </button>
          ))}
        </div>

        {badge && (
          <div className="pointer-events-none absolute left-0 top-3 flex flex-col items-start gap-1.5 sm:left-[calc(50%-18rem+0.75rem)]">
            {badge}
          </div>
        )}

        {count > 1 && (
          <p
            aria-live="polite"
            className="pointer-events-none absolute bottom-3 right-0 rounded-full bg-[#001822]/70 px-3 py-1 text-xs font-semibold text-white sm:right-[calc(50%-18rem+0.75rem)]"
          >
            {safeIndex + 1} / {count}
          </p>
        )}
      </div>

      {/* ── zoom ───────────────────────────────────────────────────── */}
      <DialogRoot open={zoomed} onOpenChange={setZoomed}>
        <DialogContent
          className="w-[calc(100%-2rem)] max-w-5xl overflow-hidden p-0"
          aria-describedby={undefined}
        >
          <DialogTitle className="sr-only">{productName} — enlarged image</DialogTitle>
          <div className="relative aspect-square w-full bg-tile">
            <Image
              src={active.url}
              alt={active.alt || productName}
              fill
              sizes="90vw"
              className="object-contain"
            />
            {count > 1 && (
              <>
                <GalleryArrow side="left" onClick={() => go(safeIndex - 1)} />
                <GalleryArrow side="right" onClick={() => go(safeIndex + 1)} />
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => setZoomed(false)}
            aria-label="Close image"
            className="absolute right-3 top-3 flex size-10 items-center justify-center rounded-full bg-white/90 text-neutral-800 transition hover:bg-white"
          >
            <X className="size-4" />
          </button>
        </DialogContent>
      </DialogRoot>
    </div>
  );
}

function GalleryArrow({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? 'Previous image' : 'Next image'}
      className={cn(
        'absolute top-1/2 z-10 flex size-10 -translate-y-1/2 items-center justify-center rounded-full',
        'bg-white/85 text-neutral-800 backdrop-blur transition hover:bg-white',
        side === 'left' ? 'left-3' : 'right-3',
      )}
    >
      <Icon className="size-5" />
    </button>
  );
}

export function ProductGallerySkeleton() {
  return (
    <div className="lg:flex lg:gap-4">
      <div className="hidden lg:flex lg:w-20 lg:shrink-0 lg:flex-col lg:gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="aspect-square animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
      <div className="-mx-5 aspect-square animate-pulse bg-muted sm:mx-auto sm:max-w-xl sm:rounded-2xl lg:mx-0 lg:max-w-none lg:flex-1" />
    </div>
  );
}
