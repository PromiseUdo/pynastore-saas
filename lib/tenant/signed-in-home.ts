/*
 * lib/tenant/signed-in-home.ts
 *
 * Where someone lands right after signing in, as a full address: their
 * shop's dashboard on its own host, or onboarding if they have no shop.
 *
 * The proxy does the same for a signed-in GET of '/', but sign-in itself
 * can't rely on that: since Next 16.4 a server action's redirect to '/'
 * renders that page in the same response, without the proxy, so the person
 * was shown the sign-in page again while already signed in. Redirecting to
 * an address on another host makes the browser load it for real.
 */
import { prisma } from '@/lib/prisma';
import { getAdminUrl, getMarketingUrl } from './urls';

export async function signedInHomeUrl(userId: string): Promise<string> {
  // An active shop first; failing that a suspended one, which explains
  // itself — the same choice the proxy makes for '/'.
  const memberships = await prisma.membership.findMany({
    where: { userId, status: 'ACTIVE', organization: { status: { in: ['ACTIVE', 'SUSPENDED'] } } },
    select: { organization: { select: { slug: true, status: true } } },
    orderBy: { joinedAt: 'asc' },
  });
  const slug = (memberships.find((m) => m.organization.status === 'ACTIVE') ?? memberships[0])?.organization.slug;
  return slug ? getAdminUrl(slug, '/dashboard') : getMarketingUrl('/onboarding');
}
