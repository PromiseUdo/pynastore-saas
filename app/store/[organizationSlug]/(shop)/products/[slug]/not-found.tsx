/*
 * Product not found.
 *
 * Scoped to this route rather than relying on the storefront-wide 404, so
 * the copy can be about the product ("removed or no longer available")
 * rather than about the URL, and so the recovery links are shopping links.
 *
 * Server component — the departments below are read from the catalogue, so
 * every one of them leads somewhere with stock behind it.
 */
import Link from 'next/link';
import { PackageX } from 'lucide-react';
import { getFeaturedCategories } from '@/lib/storefront/catalog';
import { categoryHref } from '@/lib/storefront/navigation';

export default async function ProductNotFound() {
  const categories = await getFeaturedCategories();

  return (
    <div className="sf-container py-16 lg:py-24">
      <div className="mx-auto max-w-md text-center">
        <span className="mx-auto mb-5 flex size-14 items-center justify-center rounded-full bg-secondary">
          <PackageX aria-hidden className="size-6 text-muted-foreground" />
        </span>

        <h1 className="font-display text-3xl leading-tight">Product not found</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          That product may have been removed or is no longer available. The rest of the store is
          still here.
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
            Search for something else
          </Link>
        </div>

        {categories.length > 0 && (
          <div className="mt-10">
            <p className="mb-3 text-sm font-medium">Or start from a department</p>
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
      </div>
    </div>
  );
}
