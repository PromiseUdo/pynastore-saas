/*
 * /collections — the index of curated and dynamic collections.
 *
 * Featured collections lead; the rest follow under a quieter heading. Every
 * tile carries a live count from the catalogue, and a collection that
 * currently resolves to nothing is dropped upstream rather than rendered as
 * a dead tile (see getCollectionSummaries).
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/storefront/common/breadcrumbs';
import { CollectionGrid } from '@/components/storefront/collection/collection-grid';
import { getCollectionSummaries } from '@/lib/storefront/catalog';

type Props = { params: Promise<{ organizationSlug: string }> };

export const metadata: Metadata = {
  title: 'Collections',
  description:
    'Edits that cut across departments — new arrivals, best sellers, travel essentials and more.',
};

export default async function CollectionsPage({ params }: Props) {
  const { organizationSlug } = await params;
  const collections = await getCollectionSummaries({ store: { organizationSlug } });

  const featured = collections.filter((c) => c.featured);
  const rest = collections.filter((c) => !c.featured);

  return (
    <div className="sf-container py-6 lg:py-10">
      <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Collections' }]} className="mb-4" />

      <header className="max-w-3xl">
        <h1 className="font-display text-3xl leading-tight sm:text-4xl">Collections</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          A category tells you what something is. A collection tells you why these things belong
          together — packing for a trip, kitting out a desk, or simply what sold best this month.
        </p>
      </header>

      {collections.length === 0 ? (
        <div className="mt-10 rounded-2xl border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
            There are no collections in this store yet.
          </p>
          <Link
            href="/products"
            className="mt-5 inline-flex h-11 items-center rounded-full bg-brand px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand-hover"
          >
            Browse all products
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-8">
            <CollectionGrid collections={featured.length ? featured : collections} />
          </div>

          {featured.length > 0 && rest.length > 0 && (
            <section className="mt-14 border-t pt-10">
              <h2 className="mb-6 text-xl font-semibold tracking-tight sm:text-2xl">More edits</h2>
              <CollectionGrid collections={rest} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
