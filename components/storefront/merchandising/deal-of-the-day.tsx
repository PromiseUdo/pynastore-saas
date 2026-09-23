/*
 * The deal band — the one full-bleed block of colour on the page.
 *
 * Everything else sits on cream, so this yellow slab carries all the urgency
 * on its own; the copy inside it stays calm rather than shouting, which is
 * what keeps the page feeling warm instead of like a flash-sale site.
 *
 * Server component apart from the countdown, which has to tick.
 */
import Image from 'next/image';
import { ProductImage } from '@/components/storefront/product/product-image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { Product } from '@/lib/storefront/types';
import { CountdownTimer } from '@/components/storefront/common/countdown-timer';
import { discountPercent, formatMoney } from '@/lib/storefront/format';

export function DealOfTheDay({ product, endsAt }: { product: Product; endsAt: string }) {
  const pct = discountPercent(product.priceFrom, product.compareAtPrice);
  const href = `/products/${product.slug}`;

  return (
    <section className="sf-band bg-highlight text-highlight-foreground">
      <div className="sf-container">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-highlight-foreground/10 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.14em]">
              <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-highlight-foreground" />
              Deal of the day
            </p>

            <h2 className="mt-6 text-4xl leading-[1.08] lg:text-[3.25rem]">{product.name}</h2>

            <p className="mt-5 max-w-md text-base leading-relaxed text-highlight-foreground/75">
              {product.shortDescription}
            </p>

            <div className="mt-7 flex flex-wrap items-baseline gap-3">
              <span className="text-4xl font-bold">
                {formatMoney(product.priceFrom, product.currency)}
              </span>
              {pct != null && (
                <>
                  <span className="text-xl text-highlight-foreground/55 line-through">
                    {formatMoney(product.compareAtPrice!, product.currency)}
                  </span>
                  <span className="rounded-full bg-highlight-foreground px-3 py-1 text-sm font-bold text-highlight">
                    Save {pct}%
                  </span>
                </>
              )}
            </div>

            <div className="mt-9">
              <p className="mb-3.5 text-xs font-semibold uppercase tracking-[0.14em] text-highlight-foreground/70">
                Offer ends in
              </p>
              <CountdownTimer endsAt={endsAt} tone="contrast" />
            </div>

            <Link
              href={href}
              className="group mt-9 inline-flex h-13 items-center gap-2.5 rounded-full bg-highlight-foreground px-8 text-sm font-semibold text-highlight transition-opacity hover:opacity-90"
            >
              Shop this deal
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>

          <Link href={href} className="group relative block">
            <div className="relative aspect-square overflow-hidden rounded-[2rem] bg-tile lg:rounded-[2.5rem]">
              <ProductImage
                src={product.images[0]?.url ?? null}
                name={product.name}
                alt={product.name}
                fill
                sizes="(max-width: 1024px) 100vw, 45vw"
                className="object-cover transition-transform duration-700 ease-out group-hover:scale-105"
              />
            </div>
            {pct != null && (
              /* Overlaps the LEFT edge, never the top: a badge hanging off
                * the top of a section slides under the sticky header. */
              <span className="absolute -left-4 top-1/2 flex size-20 -translate-y-1/2 rotate-[-8deg] flex-col items-center justify-center rounded-full bg-highlight-foreground text-highlight lg:-left-8 lg:size-24">
                <span className="text-xl font-bold leading-none lg:text-2xl">−{pct}%</span>
                <span className="mt-0.5 text-[10px] uppercase tracking-wide opacity-80">today</span>
              </span>
            )}
          </Link>
        </div>
      </div>
    </section>
  );
}
