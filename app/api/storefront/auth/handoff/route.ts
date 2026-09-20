/*
 * GET /api/storefront/auth/handoff?token=…&to=…
 *
 * Runs on the STORE's origin — subdomain, custom domain, or the mobile host.
 * Spends the one-minute ticket the Google callback minted, sets the store's
 * session cookie here (where it belongs), and drops the shopper back exactly
 * where they were when they pressed the button.
 *
 * The store is worked out from the ORIGIN this request arrived on, never
 * from the ticket, and the ticket is then required to match it. That
 * ordering is the whole point: a ticket minted for acme must be worthless if
 * presented on zed's domain, and it can only be worthless if the two facts
 * come from different places.
 *
 * `to` is re-validated against that same store before anyone is redirected
 * to it. It arrived in a URL, so it is treated as though a stranger wrote
 * it — because one might have.
 */
import { NextResponse } from 'next/server';
import { getMarketingUrl } from '@/lib/tenant/urls';
import { isLocalHostname, resolveHostname } from '@/lib/tenant/resolveHostname';
import { resolveTenant } from '@/lib/tenant/resolveTenant';
import { prisma } from '@/lib/prisma';
import { consumeHandoffToken } from '@/lib/storefront/account/handoff';
import { signSessionToken, sessionCookieName, SESSION_TTL_DAYS } from '@/lib/storefront/account/session';
import { storeReturnUrl, storeUrl } from '@/lib/storefront/account/return-url';

/**
 * The slug this origin serves.
 *
 * proxy.ts skips /api entirely, so there is no `x-org-slug` header here and
 * the hostname has to be read directly — the same resolution the proxy does
 * for pages. On the shared mobile origin the host names no store, so the
 * slug comes from the /s/{slug} path the shopper is returning to.
 */
async function storeSlugForOrigin(request: Request, to: string): Promise<string | null> {
  const info = resolveHostname(request.headers.get('host'));

  if (info.siteType === 'mobile') {
    try {
      const match = new URL(to).pathname.match(/^\/s\/([^/]+)/);
      return match?.[1] ?? null;
    } catch {
      return null;
    }
  }

  const tenant = await resolveTenant(info);
  return tenant?.siteType === 'storefront' ? tenant.orgSlug : null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token') ?? '';
  const to = url.searchParams.get('to') ?? '';

  const slug = await storeSlugForOrigin(request, to);
  if (!slug) return NextResponse.redirect(getMarketingUrl('/'));

  const claims = await consumeHandoffToken(token, slug);
  if (!claims) return NextResponse.redirect(getMarketingUrl('/'));

  const store = await prisma.organization.findFirst({
    where: { id: claims.organizationId, slug, status: 'ACTIVE' },
    select: { id: true, name: true, slug: true, customStoreDomain: true },
  });
  if (!store) return NextResponse.redirect(getMarketingUrl('/'));

  const destination = storeReturnUrl(to, store) ?? storeUrl(store, '/account');
  const sessionToken = await signSessionToken(claims);

  const response = NextResponse.redirect(destination);
  response.cookies.set(sessionCookieName(store.slug), sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    // The Host header, not `request.url` — see the note in the start route.
    secure: !isLocalHostname(request.headers.get('host') ?? '') && process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  });

  return response;
}
