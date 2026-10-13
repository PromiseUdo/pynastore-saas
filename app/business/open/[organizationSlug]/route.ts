/*
 * /o/{slug}/{path} on the business host (ROADMAP 19.1) — proxy.ts rewrites
 * it here as /business/open/{slug}?to={path}.
 *
 * Switches the session to that shop when the person is an active member of
 * it, then lands on the page. Anyone else goes to the "no access" page: a
 * link to another shop never shows that shop, and never moves the session.
 *
 * A route handler, not a page, because switching writes the session cookie.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { updateCurrentOrganization } from '@/lib/session';
import { BUSINESS_NO_ACCESS_PATH, canOpenShop, safeBusinessPath } from '@/lib/tenant/business';
import { resolveHostname } from '@/lib/tenant/resolveHostname';
import { getBusinessUrl } from '@/lib/tenant/urls';

export async function GET(request: Request, { params }: { params: Promise<{ organizationSlug: string }> }) {
  // Only ever on the business host; the proxy sends nothing else here.
  if (resolveHostname(request.headers.get('host')).siteType !== 'business') {
    return new NextResponse(null, { status: 404 });
  }

  const session = await auth();
  const userId = session?.user?.id;
  const { organizationSlug } = await params;
  const to = safeBusinessPath(new URL(request.url).searchParams.get('to'));

  if (!userId) {
    const login = new URL(getBusinessUrl('/login'));
    login.searchParams.set('callbackUrl', getBusinessUrl(`/o/${organizationSlug}${to === '/dashboard' ? '' : to}`));
    return NextResponse.redirect(login);
  }

  const shop = await canOpenShop(userId, organizationSlug);
  if (!shop) return NextResponse.redirect(getBusinessUrl(BUSINESS_NO_ACCESS_PATH));

  // Always: it also writes this host's own shop cookie, which the JWT's slug
  // may agree with while the cookie doesn't (lib/session.ts).
  await updateCurrentOrganization(userId, shop.id, shop.slug);
  return NextResponse.redirect(getBusinessUrl(to));
}
