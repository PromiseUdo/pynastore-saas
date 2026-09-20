/*
 * The collections index.
 *
 * Each card shows real member imagery and a real count, both resolved from
 * the catalogue by `getCollectionSummaries()` — a collection with nothing in
 * it never reaches this component, so no tile here opens an empty page.
 *
 * Server component; links only.
 */
import Image from 'next/image';
import Link from 'next/link';
import type { CollectionSummary } from '@/lib/storefront/types';

export function collectionHref(slug: string): string {
  return `/collections/${slug}`;
}

export function CollectionGrid({ collections }: { collections: CollectionSummary[] }) {
  if (!collections.length) return null;

  return (
    <ul className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
      {collections.map((collection, i) => (
        <li key={collection.id}>
          <Link href={collectionHref(collection.slug)} className="group block">
            <span className="relative block aspect-[4/3] overflow-hidden rounded-[1.25rem] bg-tile">
              {/* The merchant's own card image, or failing that a product
                * genuinely in the collection — never a stand-in from
                * elsewhere. A collection with neither shows the tile colour. */}
              {(collection.imageUrl || collection.previewImages[0]) && (
                <Image
                  src={collection.imageUrl || collection.previewImages[0]}
                  alt=""
                  fill
                  sizes="(max-width: 640px) 90vw, (max-width: 1024px) 45vw, 30vw"
                  priority={i < 3}
                  className="object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                />
              )}
              <span
                aria-hidden
                className="absolute inset-0 bg-brand/0 transition-colors duration-300 group-hover:bg-brand/10"
              />
              <span className="absolute bottom-3 left-3 rounded-full bg-[color:var(--elevated)]/95 px-3 py-1 text-xs font-semibold">
                {collection.productCount.toLocaleString()}{' '}
                {collection.productCount === 1 ? 'product' : 'products'}
              </span>
            </span>

            <span className="mt-4 block font-display text-xl leading-snug transition-colors group-hover:text-teal">
              {collection.name}
            </span>
            <span className="mt-1.5 block text-sm leading-relaxed text-muted-foreground">
              {collection.tagline}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
