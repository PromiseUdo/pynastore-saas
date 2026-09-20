/*
 * /search/image — visual product search.
 *
 * A sibling of /search rather than a separate world: it is the same results
 * surface, reached by a different kind of query. The only thing this route
 * does that /search doesn't is resolve WHICH products before handing over —
 * after that the Product Discovery Service owns everything (§14, §16, §17):
 *
 *   ?vq=<query id>    ─▶ visualSearchProducts()   ← exact cosine search over
 *   ?p=<product id>          ↓ ranked product ids   this store's product-image
 *                                                   embeddings (pgvector)
 *                        DiscoveryScope { productIds, relevanceOrder }
 *                            ↓
 *                        loadDiscoveryPage()  ─▶ <CatalogView>
 *                                                 filters, sort, facets,
 *                                                 pager, <ProductCard>
 *
 * A Server Component, like every other results page here, which is what
 * makes a visual result set refreshable and back-button-correct. `vq` is a
 * stored search (the photo's embedding, never the photo — see
 * features/shop-visual-search) bound to THIS store: the store is the route's
 * own `organizationSlug`, set by the proxy from the host, so a query id
 * pasted into another store's page finds nothing. Re-rendering costs a
 * database query, not a model call.
 *
 * The visual query rides on the PATHNAME handed to the discovery service, so
 * every filter chip, sort option and pager link carries it — a shopper who
 * ticks "In stock" refines their visual results instead of losing them (§18).
 */
import type { Metadata } from 'next';
import { CatalogView } from '@/components/storefront/catalog/catalog-view';
import { SearchField } from '@/components/storefront/catalog/search-field';
import { ImagePicker } from '@/components/storefront/visual-search/image-picker';
import { VisualMatchHeader } from '@/components/storefront/visual-search/visual-match-header';
import { VisualNoMatches } from '@/components/storefront/visual-search/visual-no-matches';
import { VisualSearchIntro } from '@/components/storefront/visual-search/visual-search-intro';
import { getFeaturedCategories, getProductById } from '@/lib/storefront/catalog';
import { loadDiscoveryPage } from '@/lib/storefront/product-discovery';
import { prisma } from '@/lib/prisma';
import { parseVisualSource, visualSearchPathname } from '@/lib/storefront/visual-search/query';
import { matchesToScope, visualSearchProducts } from '@/lib/storefront/visual-search/service';
import { VisualSearchError } from '@/lib/storefront/visual-search/types';
import type { VisualSearchResponse } from '@/lib/storefront/visual-search/types';

type Props = {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata: Metadata = {
  title: 'Search by image',
  description: 'Upload a photo and find visually similar products in this store.',
  // Shopper state, not a catalogue page — and a result set nobody else can
  // reproduce without the same token.
  robots: { index: false, follow: true },
};

export default async function VisualSearchPage({ params, searchParams }: Props) {
  const [{ organizationSlug }, rawParams] = await Promise.all([params, searchParams]);
  const source = parseVisualSource(rawParams);

  /* ── nothing chosen yet (also where a junk token lands) ─────────────── */
  if (!source) {
    // Same read the storefront layout does — the public identity of the
    // tenant, not the membership context (this page has no signed-in user).
    const [organization, categories] = await Promise.all([
      prisma.organization.findFirst({
        where: { slug: organizationSlug, status: 'ACTIVE' },
        select: { name: true },
      }),
      getFeaturedCategories({ organizationSlug }),
    ]);
    return (
      <div className="sf-container py-8 lg:py-14">
        <VisualSearchIntro
          storeName={organization?.name ?? 'this store'}
          categories={categories}
        />
      </div>
    );
  }

  /* ── run the search ─────────────────────────────────────────────────── */
  let response: VisualSearchResponse | null = null;
  let failure: string | undefined;
  try {
    response = await visualSearchProducts({
      store: { organizationSlug },
      source,
    });
  } catch (error) {
    // A broken link, an expired search and an outage each get a sentence and
    // somewhere else to go. None is worth a 500, none shows an internal message.
    const code = error instanceof VisualSearchError ? error.code : 'unavailable';
    failure =
      code === 'invalid_source'
        ? 'That link no longer points at a product we stock.'
        : code === 'expired'
          ? 'That image search has expired. Search with your photo again to see matches.'
          : 'Search by image isn’t responding right now. Try again in a moment, or search by name.';
  }

  if (!response || !response.matches.length) {
    const categories = await getFeaturedCategories({ organizationSlug });
    return (
      <div className="sf-container py-8 lg:py-12">
        <VisualNoMatches categories={categories} message={failure} />
      </div>
    );
  }

  /* ── hand the ranked set to the Product Discovery Service ───────────── */
  const pathname = visualSearchPathname(source);
  const sourceProduct =
    source.kind === 'product' ? await getProductById(source.productId, { organizationSlug }) : null;

  const { view, emptyState, emptyCategories } = await loadDiscoveryPage({
    organizationSlug,
    rawParams,
    pathname,
    defaults: {
      // Pinned by the route, exactly like a collection's rule: a shopper can
      // narrow within their visual results but never filter their way out of
      // them, and no amount of URL editing widens the set.
      scope: matchesToScope(response),
      sort: 'relevance',
    },
  });

  // Looks up this tab's own preview of the photo, if it has one.
  const token = source.kind === 'query' ? source.queryId : undefined;

  return (
    <CatalogView
      view={view}
      pathname={pathname}
      emptyState={emptyState}
      emptyCategories={emptyCategories}
      showChildCategories={false}
      crumbs={[
        { label: 'Home', href: '/' },
        { label: 'Search', href: '/search' },
        { label: 'By image' },
      ]}
      header={
        <VisualMatchHeader
          confidence={response.confidence}
          attributes={response.attributes}
          total={response.total}
          token={token}
          sourceProductName={sourceProduct?.name}
        />
      }
      intro={
        /* Searching again is the single most common next action, so it is on
         * the page rather than behind the link in the header. */
        <details className="mt-6 rounded-2xl border border-border bg-card/50">
          <summary className="cursor-pointer list-none px-5 py-3.5 text-sm font-semibold marker:hidden">
            Search with a different image
          </summary>
          <div className="px-3 pb-3">
            <ImagePicker variant="compact" />
          </div>
        </details>
      }
    >
      <SearchField
        criteria={view.criteria}
        optionIndex={view.optionIndex}
        pathname={pathname}
        placeholder="Search within these matches"
      />
    </CatalogView>
  );
}
