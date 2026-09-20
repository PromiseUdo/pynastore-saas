/*
 * GET /api/storefront/auth/google/callback
 *
 * The one redirect URI registered with Google for every storefront on the
 * platform. It finishes the OAuth exchange, finds or creates the shopper's
 * account at the store named in `state`, and then hands the session over to
 * that store's own origin as a one-minute ticket — because this origin (the
 * root domain) must never hold a shopper session of its own.
 */
import { NextResponse } from 'next/server';
import { getMarketingUrl } from '@/lib/tenant/urls';
import { findStoreBySlug, upsertShopperFromGoogle } from '@/lib/storefront/account/shopper';
import { storeUrl } from '@/lib/storefront/account/return-url';
import { GOOGLE_STATE_COOKIE, exchangeGoogleCode, googleRedirectUri, verifyState } from '@/lib/storefront/account/google';
import { mintHandoffToken } from '@/lib/storefront/account/handoff';
import { prisma } from '@/lib/prisma';

/** Every failure lands the shopper back on the store's sign-in page, saying so once. */
function failed(storeSignIn: string | null) {
  return NextResponse.redirect(storeSignIn ?? getMarketingUrl('/'));
}

export async function GET(request: Request) {
  const url = new URL(request.url);

  const stateToken = url.searchParams.get('state') ?? '';
  const nonce = request.headers
    .get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${GOOGLE_STATE_COOKIE}=`))
    ?.split('=')[1];

  const state = await verifyState(stateToken, nonce);
  if (!state) return failed(null);

  const store = await findStoreBySlug(state.slug);
  if (!store) return failed(null);

  const signInUrl = storeUrl(store, '/account/sign-in?error=google');

  // The shopper pressed "cancel" on Google's screen, or Google said no.
  const code = url.searchParams.get('code');
  if (!code || url.searchParams.get('error')) {
    return failed(storeUrl(store, '/account/sign-in'));
  }

  const identity = await exchangeGoogleCode({
    code,
    // Byte-identical to the one `start` sent, or Google refuses the exchange.
    redirectUri: googleRedirectUri(),
  });
  if (!identity) return failed(signInUrl);

  let customer;
  try {
    customer = await upsertShopperFromGoogle({
      organizationId: store.id,
      googleSub: identity.sub,
      email: identity.email,
      name: identity.name,
      emailVerified: identity.emailVerified,
    });
  } catch (err) {
    console.error('[storefront-auth] Google sign-in could not create the account:', err);
    return failed(signInUrl);
  }

  await prisma.customer.update({ where: { id: customer.id }, data: { lastLoginAt: new Date() } });

  const ticket = await mintHandoffToken({
    customerId: customer.id,
    organizationId: customer.organizationId,
    slug: store.slug,
    sessionVersion: customer.sessionVersion,
  });

  const handoff = new URL('/api/storefront/auth/handoff', new URL(state.returnTo).origin);
  handoff.searchParams.set('token', ticket);
  handoff.searchParams.set('to', state.returnTo);

  const response = NextResponse.redirect(handoff);
  // The state cookie has done its job.
  response.cookies.set(GOOGLE_STATE_COOKIE, '', { path: '/api/storefront/auth', maxAge: 0 });
  return response;
}
