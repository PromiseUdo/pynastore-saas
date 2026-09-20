/*
 * GET /api/storefront/auth/google/start?slug=…&returnTo=…
 *
 * Step one of shopper Google sign-in. Runs on the ROOT domain — the only
 * origin Google will redirect back to (the full reasoning is in
 * lib/storefront/account/google.ts). A store's sign-in page links straight
 * here; if the link is followed on any other host this route bounces to
 * itself on the root domain first, so the nonce cookie and the callback
 * always share an origin.
 *
 * Nothing is trusted from the query string beyond the slug: `returnTo` is
 * checked against the hostnames that store is genuinely served on before it
 * is allowed anywhere near a session.
 */
import { NextResponse } from 'next/server';
import { getMarketingUrl } from '@/lib/tenant/urls';
import { isLocalHostname } from '@/lib/tenant/resolveHostname';
import { findStoreBySlug } from '@/lib/storefront/account/shopper';
import { storeReturnUrl, safeNextPath, storeUrl } from '@/lib/storefront/account/return-url';
import {
  GOOGLE_STATE_COOKIE,
  googleAuthUrl,
  googleConfigured,
  googleRedirectUri,
  oauthOrigin,
  signState,
} from '@/lib/storefront/account/google';
import { randomUUID } from 'crypto';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = (url.searchParams.get('slug') ?? '').trim();
  const origin = oauthOrigin();

  /*
   * Which host is this really? NOT `request.url` — Next reports the origin
   * the server is listening on, not the name the browser asked for, so
   * comparing origins from it made this route bounce to itself forever. The
   * Host header is the only thing that survives the rewrite untouched;
   * proxy.ts makes the same point in its note about `currentUrl`.
   */
  const host = (request.headers.get('host') ?? '').toLowerCase();
  const onOAuthOrigin = host === new URL(origin).host;

  const store = await findStoreBySlug(slug);
  if (!store || !googleConfigured()) {
    // No store, or Google isn't set up on this deployment: send them
    // somewhere real rather than showing a broken provider screen.
    return NextResponse.redirect(
      store ? storeUrl(store, '/account/sign-in?error=google') : getMarketingUrl('/'),
    );
  }

  // Ensure we're on the OAuth origin before setting the nonce cookie: it has
  // to be readable by the callback, which Google will only ever send to that
  // one origin.
  if (!onOAuthOrigin) {
    const bounced = new URL('/api/storefront/auth/google/start', origin);
    bounced.search = url.search;
    return NextResponse.redirect(bounced);
  }

  const next = safeNextPath(url.searchParams.get('next'), '/account');
  const returnTo =
    storeReturnUrl(url.searchParams.get('returnTo') ?? '', store) ?? storeUrl(store, next);

  const nonce = randomUUID();
  const state = await signState({ slug: store.slug, returnTo, next, nonce });

  const response = NextResponse.redirect(
    googleAuthUrl({
      redirectUri: googleRedirectUri(),
      state,
      loginHint: url.searchParams.get('email'),
    }),
  );

  response.cookies.set(GOOGLE_STATE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: 'lax',
    secure: !isLocalHostname(host ?? '') && process.env.NODE_ENV === 'production',
    path: '/api/storefront/auth',
    maxAge: 10 * 60,
  });

  return response;
}
