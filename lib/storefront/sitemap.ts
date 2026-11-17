/*
 * lib/storefront/sitemap.ts — what goes in each store's sitemap.xml
 * (served by app/store/[organizationSlug]/sitemap.xml/route.ts).
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
import { getOrgRouting } from '@/lib/tenant/org-status';
import { prisma } from '@/lib/prisma';
import type { CategoryNode } from './types';

/** Search engines stop reading a sitemap long before this. */
const MAX_PRODUCTS = 5000;

function flatten(nodes: CategoryNode[], trail: string[] = []): string[][] {
  return nodes.flatMap((node) => {
    const path = [...trail, node.slug];
    return [path, ...flatten(node.children ?? [], path)];
  });
}

export async function storeSitemapEntries(organizationSlug: string): Promise<MetadataRoute.Sitemap> {
  const scope = { organizationSlug };

  // Not open yet (12.5), or not a live shop: nothing to list.
  const open = await prisma.organization.count({ where: { slug: organizationSlug, status: 'ACTIVE', storefrontOpen: true } });
  if (!open) return [];
  // The shop's own domain once it's live (12.6), else its platform address.
  const { customStoreDomain } = await getOrgRouting(organizationSlug);
  const url = (path: string) => getStorefrontUrl(organizationSlug, path, customStoreDomain);

  const [products, tree, collections, pages] = await Promise.all([
    listProducts({ perPage: MAX_PRODUCTS, store: scope }),
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

const escapeXml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** The entries as sitemap XML (sitemaps.org 0.9). */
export function sitemapXml(entries: MetadataRoute.Sitemap): string {
  const urls = entries.map((entry) => {
    const parts = [`<loc>${escapeXml(entry.url)}</loc>`];
    if (entry.lastModified) parts.push(`<lastmod>${new Date(entry.lastModified).toISOString()}</lastmod>`);
    if (entry.changeFrequency) parts.push(`<changefreq>${entry.changeFrequency}</changefreq>`);
    if (entry.priority !== undefined) parts.push(`<priority>${entry.priority}</priority>`);
    return `<url>${parts.join('')}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}
