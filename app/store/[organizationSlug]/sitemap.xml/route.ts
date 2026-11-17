/*
 * sitemap.xml, per store.
 *
 * A route handler rather than Next's `sitemap.ts` convention, for the same
 * reason as robots.txt next door: every storefront lives under
 * /store/{slug}, and since Next 16.4 a nested sitemap.ts no longer receives
 * the segment's params (the build fails prerendering it). What it lists is
 * decided in lib/storefront/sitemap.ts.
 */
import { sitemapXml, storeSitemapEntries } from '@/lib/storefront/sitemap';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ organizationSlug: string }> },
) {
  const { organizationSlug } = await params;
  const entries = await storeSitemapEntries(organizationSlug);
  return new Response(sitemapXml(entries), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
