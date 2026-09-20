/*
 * lib/storefront/data/pages.ts
 *
 * The merchant's published store pages. Kept out of the catalogue on
 * purpose: every storefront page needs the list of links (footer, checkout,
 * cookie notice) but only /pages/{slug} needs a body, and a whole set of
 * terms shouldn't ride along with every category page.
 *
 * Only PUBLISHED pages of an ACTIVE store ever leave this file. Under the
 * fixtures (tests, demos) a store has no pages at all — the demo data never
 * held a merchant's policies, and inventing some is the thing this feature
 * exists to stop.
 */
import { cache } from 'react';
import { prisma } from '@/lib/prisma';
import { useFixtures } from './current';
import { storePageHref, type StorePageKind, type StorePageLink } from '../pages/rules';

export interface PublishedStorePage extends StorePageLink {
  body: string;
  updatedAt: string;
}

/** Links to every published page of one store. Memoised per request. */
export const loadStorePageLinks = cache(async (organizationSlug: string): Promise<StorePageLink[]> => {
  if (useFixtures()) return [];
  const rows = await prisma.storePage.findMany({
    where: { isPublished: true, organization: { slug: organizationSlug, status: 'ACTIVE' } },
    select: { kind: true, title: true, slug: true },
    orderBy: { title: 'asc' },
  });
  return rows.map((row) => ({
    kind: row.kind as StorePageKind,
    title: row.title,
    slug: row.slug,
    href: storePageHref(row.slug),
  }));
});

/** One published page, or null when there isn't one at that address. */
export const loadStorePage = cache(
  async (organizationSlug: string, slug: string): Promise<PublishedStorePage | null> => {
    if (useFixtures()) return null;
    const row = await prisma.storePage.findFirst({
      where: { slug, isPublished: true, organization: { slug: organizationSlug, status: 'ACTIVE' } },
      select: { kind: true, title: true, slug: true, body: true, updatedAt: true },
    });
    if (!row) return null;
    return {
      kind: row.kind as StorePageKind,
      title: row.title,
      slug: row.slug,
      href: storePageHref(row.slug),
      body: row.body,
      updatedAt: row.updatedAt.toISOString(),
    };
  },
);
