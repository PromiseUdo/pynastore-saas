'use client';

import * as React from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Product } from '@/lib/storefront/types';
import { ProductCard } from '@/components/storefront/product/product-card';
import { SectionHeader } from '@/components/storefront/common/section-header';

/**
 * Horizontally scrolling product rail.
 *
 * Free-drag with trimmed snaps: on a rail the exact snap position matters far
 * less than being able to flick it, and trimming stops the last card floating
 * in dead space.
 */
export function ProductCarousel({
  eyebrow,
  title,
  subtitle,
  href,
  products,
  priority,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  href?: string;
  products: Product[];
  /** eager-load the first cards — pass on the first rail of the page only */
  priority?: boolean;
}) {
  const [emblaRef, embla] = useEmblaCarousel({
    align: 'start',
    dragFree: true,
    containScroll: 'trimSnaps',
  });
  const [canPrev, setCanPrev] = React.useState(false);
  const [canNext, setCanNext] = React.useState(false);

  React.useEffect(() => {
    if (!embla) return;
    const update = () => {
      setCanPrev(embla.canScrollPrev());
      setCanNext(embla.canScrollNext());
    };
    embla.on('select', update);
    embla.on('reInit', update);
    update();
    return () => {
      embla.off('select', update);
      embla.off('reInit', update);
    };
  }, [embla]);

  if (!products.length) return null;

  return (
    <section className="sf-container sf-section">
      <SectionHeader eyebrow={eyebrow} title={title} subtitle={subtitle} href={href}>
        <div className="hidden gap-2 lg:flex">
          <RailButton dir="prev" disabled={!canPrev} onClick={() => embla?.scrollPrev()} />
          <RailButton dir="next" disabled={!canNext} onClick={() => embla?.scrollNext()} />
        </div>
      </SectionHeader>

      <div className="overflow-hidden" ref={emblaRef}>
        <div className="flex gap-5">
          {products.map((product, i) => (
            <div
              key={product.id}
              className="min-w-0 flex-[0_0_72%] sm:flex-[0_0_46%] md:flex-[0_0_33%] lg:flex-[0_0_25%] xl:flex-[0_0_22%]"
            >
              <ProductCard product={product} priority={priority && i < 3} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function RailButton({
  dir,
  disabled,
  onClick,
}: {
  dir: 'prev' | 'next';
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = dir === 'prev' ? ArrowLeft : ArrowRight;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === 'prev' ? 'Scroll left' : 'Scroll right'}
      className={cn(
        'flex size-11 items-center justify-center rounded-full border border-border transition-colors',
        'hover:border-brand hover:bg-brand hover:text-primary-foreground',
        'disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-border disabled:hover:bg-transparent disabled:hover:text-foreground',
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}
