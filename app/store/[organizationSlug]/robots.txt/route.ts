/*
 * robots.txt, per store.
 *
 * A route handler rather than Next's `robots.ts` convention, because that
 * one is only picked up at the root of `app/` — and every storefront lives
 * under /store/{slug}, reached by proxy.ts rewriting the merchant's own
 * hostname. A file convention that never registers is worse than no file:
 * the build says nothing and the shop quietly has no robots.txt.
 *
 * Everything a shopper browses is open. Everything that belongs to one
 * person — their account, their bag, the checkout, an order lookup, an
 * invoice link — is not, because those pages are private, useless in an
 * index, or both.
 */
import { getStorefrontUrl } from '@/lib/tenant/urls';
import { prisma } from '@/lib/prisma';

const PRIVATE = ['/account', '/cart', '/checkout', '/wishlist', '/track-order', '/invoice/'];

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ organizationSlug: string }> },
) {
  const { organizationSlug } = await params;

  /* A slug that isn't a live shop gets a closed robots.txt rather than a
   * sitemap pointing at nothing. */
  const store = await prisma.organization.findFirst({
    where: { slug: organizationSlug, status: 'ACTIVE' },
    select: { id: true },
  });

  const body = store
    ? [
        'User-agent: *',
        'Allow: /',
        ...PRIVATE.map((path) => `Disallow: ${path}`),
        '',
        `Sitemap: ${getStorefrontUrl(organizationSlug, '/sitemap.xml')}`,
        '',
      ].join('\n')
    : ['User-agent: *', 'Disallow: /', ''].join('\n');

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
