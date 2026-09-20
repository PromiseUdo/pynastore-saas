/*
 * The storefront's 404.
 *
 * Reached by `notFound()` from a category or collection route with an
 * unknown slug, and by any unmatched storefront path. It lives inside the
 * (shop) group so it renders with the header, nav and footer — a shopper who
 * mistypes a URL should land somewhere they can shop from, not on a bare
 * system page with no way back into the store.
 *
 * Server component: the links below are the whole point of the page.
 */
import Link from 'next/link';
import { Compass } from 'lucide-react';
import { getFeaturedCategories, getCollectionSummaries } from '@/lib/storefront/catalog';
import { collectionHref } from '@/components/storefront/collection/collection-grid';
import { categoryHref } from '@/lib/storefront/navigation';

export default async function StorefrontNotFound() {
  /*
   * Real departments and real collections, read from the catalogue — the
   * same rule the empty search state follows. A 404 that offers links to
   * things that don't exist either is the worst version of this page.
   */
  const [categories, collections] = await Promise.all([
    getFeaturedCategories(),
    getCollectionSummaries({ featuredOnly: true, limit: 4 }),
  ]);

  return (
    <div className="sf-container py-16 lg:py-24">
      <div className="mx-auto max-w-lg text-center">
        <span className="mx-auto mb-6 flex size-14 items-center justify-center rounded-full bg-secondary">
          <Compass aria-hidden className="size-6 text-muted-foreground" />
        </span>

        <h1 className="font-display text-3xl leading-tight sm:text-4xl">
          We couldn’t find that page
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          The link may be out of date, or the category or collection it pointed to is no longer in
          the store. Everything below is still here.
        </p>

        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link
            href="/products"
            className="h-11 rounded-full bg-brand px-5 text-sm font-semibold leading-[2.75rem] text-primary-foreground transition-colors hover:bg-brand-hover"
          >
            Browse all products
          </Link>
          <Link
            href="/search"
            className="h-11 rounded-full border px-5 text-sm font-semibold leading-[2.75rem] transition-colors hover:border-brand hover:text-brand"
          >
            Search the store
          </Link>
        </div>

        {categories.length > 0 && (
          <div className="mt-10 text-left">
            <p className="mb-3 text-center text-sm font-medium">Departments</p>
            <div className="flex flex-wrap justify-center gap-2">
              {categories.map((category) => (
                <Link
                  key={category.id}
                  href={categoryHref(category.path)}
                  className="rounded-full border px-4 py-2 text-sm transition-colors hover:border-brand hover:text-brand"
                >
                  {category.name}
                </Link>
              ))}
            </div>
          </div>
        )}

        {collections.length > 0 && (
          <div className="mt-8 text-left">
            <p className="mb-3 text-center text-sm font-medium">Collections</p>
            <div className="flex flex-wrap justify-center gap-2">
              {collections.map((collection) => (
                <Link
                  key={collection.id}
                  href={collectionHref(collection.slug)}
                  className="rounded-full border px-4 py-2 text-sm transition-colors hover:border-brand hover:text-brand"
                >
                  {collection.name}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
