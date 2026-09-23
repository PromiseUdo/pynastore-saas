/*
 * sitemap.xml, per store.
 *
 * Built from the merchant's own catalogue through the usual seam, so it can
 * only ever list what a shopper is allowed to see: published products, visible
 * categories and collections, and the pages the merchant has published.
 *
 * Nothing invented — a shop with three products has a sitemap with three
 * products in it.
 */
import type { MetadataRoute } from 'next';
import {
  getCategoryTree,
  getCollections,
  getStorePages,
  listProducts,
} from '@/lib/storefront/catalog';
import { getStorefrontUrl } from '@/lib/tenant/urls';
import type { CategoryNode } from '@/lib/storefront/types';

/** Search engines stop reading a sitemap long before this. */
const MAX_PRODUCTS = 5000;

function flatten(nodes: CategoryNode[], trail: string[] = []): string[][] {
  return nodes.flatMap((node) => {
    const path = [...trail, node.slug];
    return [path, ...flatten(node.children ?? [], path)];
  });
}

export default async function sitemap({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}): Promise<MetadataRoute.Sitemap> {
  const { organizationSlug } = await params;
  const scope = { organizationSlug };
  const url = (path: string) => getStorefrontUrl(organizationSlug, path);

  const [products, tree, collections, pages] = await Promise.all([
    listProducts({ perPage: MAX_PRODUCTS, ...scope }),
    getCategoryTree(scope),
    getCollections(scope),
    getStorePages(scope),
  ]);

  return [
    { url: url('/'), changeFrequency: 'daily', priority: 1 },
    { url: url('/products'), changeFrequency: 'daily', priority: 0.9 },
    ...flatten(tree).map((path) => ({
      url: url(`/c/${path.join('/')}`),
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
    ...collections.map((collection) => ({
      url: url(`/collections/${collection.slug}`),
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
    ...products.items.map((product) => ({
      url: url(`/products/${product.slug}`),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
    ...pages.map((page) => ({
      url: url(`/pages/${page.slug}`),
      changeFrequency: 'monthly' as const,
      priority: 0.4,
    })),
  ];
}
