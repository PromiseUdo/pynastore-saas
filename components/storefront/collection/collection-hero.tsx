/*
 * The top of a collection page.
 *
 * A collection is an editorial object — someone chose these things and can
 * say why — so this header carries more voice than a category's does: a
 * tagline, a paragraph, and an image when the collection has one. Where it
 * doesn't, the type carries the page on its own rather than a placeholder
 * box being invented to fill the layout.
 *
 * The count sits in the header rather than only above the grid, because on a
 * collection it is part of the pitch ("ten things"), not just a result stat.
 */
import Image from 'next/image';
import type { Collection } from '@/lib/storefront/types';

export function CollectionHero({
  collection,
  productCount,
  children,
}: {
  collection: Collection;
  productCount: number;
  children?: React.ReactNode;
}) {
  const count = `${productCount.toLocaleString()} ${productCount === 1 ? 'product' : 'products'}`;

  if (!collection.heroImageUrl) {
    return (
      <header className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal">Collection</p>
        <h1 className="mt-2 font-display text-3xl leading-[1.1] sm:mt-3 sm:text-4xl lg:text-5xl">
          {collection.name}
        </h1>
        <p className="mt-2 text-base leading-relaxed sm:mt-3 sm:text-lg">{collection.tagline}</p>
        <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground sm:mt-3 sm:line-clamp-none">
          {collection.description}
        </p>
        <p className="mt-3 text-sm font-semibold sm:mt-4">{count}</p>
        {children}
      </header>
    );
  }

  return (
    <header className="overflow-hidden rounded-2xl border bg-card sm:rounded-[1.5rem]">
      {/* Image above the words on a phone, beside them from lg — stacking the
        * other way would push the copy (and the count) below the fold. On a
        * phone the image is a banner strip (5:2, not 16:9) and the paragraph
        * is clamped, so the first products are closer to the first screen. */}
      <div className="grid lg:grid-cols-2">
        <div className="relative aspect-[5/2] bg-tile sm:aspect-[16/9] lg:order-2 lg:aspect-auto lg:min-h-[22rem]">
          <Image
            src={collection.heroImageUrl}
            alt=""
            fill
            priority
            sizes="(max-width: 1024px) 100vw, 50vw"
            className="object-cover"
          />
        </div>

        <div className="flex flex-col justify-center px-5 py-5 sm:px-10 sm:py-12">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal">Collection</p>
          <h1 className="mt-2 font-display text-[1.75rem] leading-[1.1] sm:mt-3 sm:text-4xl">
            {collection.name}
          </h1>
          <p className="mt-2 text-base leading-relaxed sm:mt-3 sm:text-lg">{collection.tagline}</p>
          <p className="mt-2 line-clamp-2 max-w-prose text-sm leading-relaxed text-muted-foreground sm:mt-3 sm:line-clamp-none">
            {collection.description}
          </p>
          <p className="mt-3 text-sm font-semibold sm:mt-4">{count}</p>
          {children}
        </div>
      </div>
    </header>
  );
}
