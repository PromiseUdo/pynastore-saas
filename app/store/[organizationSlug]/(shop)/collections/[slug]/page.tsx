/*
 * /collections/{slug} — a curated or dynamic collection.
 *
 * Same engine again: the collection's rule becomes a pinned DiscoveryScope
 * (product ids for a curated list, an attribute rule for a dynamic one) and
 * everything the shopper then does — search within, filter, sort, page — is
 * the identical code path /search and /c/[...path] take. The scope is not
 * encoded in the query string, so no amount of URL editing turns
 * /collections/under-50k into a page showing a ₦1.6m laptop.
 *
 * Editorially it reads differently from a category: the hero carries a
 * tagline and a paragraph, and the top rail is the editor's opening run
 * rather than a sales ranking.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CatalogView } from '@/components/storefront/catalog/catalog-view';
import { HighlightRail } from '@/components/storefront/catalog/highlight-rail';
import { SearchField } from '@/components/storefront/catalog/search-field';
import { CollectionHero } from '@/components/storefront/collection/collection-hero';
import {
  getCollectionLanding,
  loadDiscoveryPage,
  resolveCollectionScope,
} from '@/lib/storefront/product-discovery';
import { getCollectionBySlug } from '@/lib/storefront/catalog';
import { hasActiveFilters } from '@/lib/storefront/discovery-url';

type Props = {
  params: Promise<{ organizationSlug: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { organizationSlug, slug } = await params;
  const collection = await getCollectionBySlug(slug, { organizationSlug });
  if (!collection) return {};
  return { title: collection.name, description: collection.tagline };
}

export default async function CollectionPage({ params, searchParams }: Props) {
  const [{ organizationSlug, slug }, rawParams] = await Promise.all([params, searchParams]);
  const store = { organizationSlug };

  // Unknown slug is a 404 — never a silent fallback to the whole catalogue.
  const resolved = await resolveCollectionScope(slug, store);
  if (!resolved) notFound();

  const { collection, scope } = resolved;
  const pathname = `/collections/${collection.slug}`;

  const [{ view, emptyState, emptyCategories }, landing] = await Promise.all([
    loadDiscoveryPage({
      organizationSlug,
      rawParams,
      pathname,
      // The collection's own rule and its natural reading order. Shopper
      // filters narrow within this; they can never widen past it.
      defaults: { scope, sort: collection.sort },
    }),
    getCollectionLanding({ store, collection }),
  ]);

  const { criteria, result } = view;
  const browsing =
    !criteria.q && !hasActiveFilters(criteria) && criteria.page === 1 && result.total > 0;

  // A rail is only worth the space when there is materially more below it.
  const showHighlights =
    browsing && landing.highlights.length >= 4 && landing.productCount > landing.highlights.length + 2;

  return (
    <CatalogView
      view={view}
      pathname={pathname}
      emptyState={emptyState}
      emptyCategories={emptyCategories}
      showChildCategories={false}
      crumbs={[
        { label: 'Home', href: '/' },
        { label: 'Collections', href: '/collections' },
        { label: collection.name },
      ]}
      header={<CollectionHero collection={collection} productCount={landing.productCount} />}
      intro={
        showHighlights ? (
          <HighlightRail
            title={collection.highlightTitle ?? 'Start here'}
            products={landing.highlights}
          />
        ) : undefined
      }
      gridTitle={showHighlights ? 'Explore the collection' : undefined}
    >
      <SearchField
        criteria={criteria}
        optionIndex={view.optionIndex}
        pathname={pathname}
        placeholder={`Search within ${collection.name}`}
      />
    </CatalogView>
  );
}
