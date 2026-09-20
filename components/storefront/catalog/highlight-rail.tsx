/*
 * A short, scannable run of products above a results grid — "Popular in
 * Shoes", "Start with these".
 *
 * Deliberately NOT <ProductCarousel>: that one is a client component with an
 * Embla instance and its own section padding, which is right for a homepage
 * band and wrong for a strip nested inside an already-padded catalogue page.
 * This is a plain overflow rail — no JavaScript, no layout shift, and it
 * flicks correctly on a phone because that is what a touch device does with
 * overflow-x by default.
 *
 * Server component; <ProductCard> is the only client boundary.
 */
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { ProductCard } from '@/components/storefront/product/product-card';
import type { Product } from '@/lib/storefront/types';

export function HighlightRail({
  title,
  subtitle,
  products,
  href,
  linkLabel = 'See all',
}: {
  title: string;
  subtitle?: string;
  products: Product[];
  href?: string;
  linkLabel?: string;
}) {
  if (!products.length) return null;

  return (
    <section className="mt-8 border-t pt-6 sm:mt-10 sm:pt-8">
      <div className="mb-4 flex items-end justify-between gap-4 sm:mb-5">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {href && (
          <Link
            href={href}
            className="group hidden shrink-0 items-center gap-1.5 text-sm font-semibold text-teal underline-offset-4 hover:underline sm:inline-flex"
          >
            {linkLabel}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        )}
      </div>

      {/* The negative margin lets the rail bleed to the screen edge on a
        * phone, so the last card is visibly cut off — the cue that there is
        * more to scroll. Padding puts the first card back on the grid. */}
      <ul className="sf-no-scrollbar -mx-5 flex snap-x snap-mandatory scroll-px-5 gap-4 overflow-x-auto px-5 pb-1 sm:mx-0 sm:scroll-px-0 sm:px-0">
        {products.map((product) => (
          <li
            key={product.id}
            className="w-[45vw] shrink-0 snap-start sm:w-52 lg:w-56"
          >
            <ProductCard product={product} />
          </li>
        ))}
      </ul>
    </section>
  );
}
