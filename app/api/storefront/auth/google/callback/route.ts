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
import { appDeepLink, deepLinkPage } from '@/lib/mobile/deep-link-page';
import { prisma } from '@/lib/prisma';

/** The deep link's host; the app recognises it by this (ROADMAP 16.1). */
const AUTH_RETURN_HOST = 'auth-return';

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

  /* Started inside a phone app: this is the in-app browser sheet, so every
   * ending — success, cancel, failure — goes back to the app by deep link,
   * and the app's WebView finishes the job (see the handoff below). */
  const app = state.app ?? null;
  const backToApp = (params: Record<string, string>) =>
    deepLinkPage({ heading: 'Signing you in', deepLink: appDeepLink(app!, AUTH_RETURN_HOST, params) });

  const signInUrl = storeUrl(store, '/account/sign-in?error=google');
  const failedHere = () => (app ? backToApp({ error: 'google' }) : failed(signInUrl));

  // The shopper pressed "cancel" on Google's screen, or Google said no.
  const code = url.searchParams.get('code');
  if (!code || url.searchParams.get('error')) {
    return app ? backToApp({}) : failed(storeUrl(store, '/account/sign-in'));
  }

  const identity = await exchangeGoogleCode({
    code,
    // Byte-identical to the one `start` sent, or Google refuses the exchange.
    redirectUri: googleRedirectUri(),
  });
  if (!identity) return failedHere();

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
    return failedHere();
  }

  await prisma.customer.update({ where: { id: customer.id }, data: { lastLoginAt: new Date() } });

  const ticket = await mintHandoffToken(
    {
      customerId: customer.id,
      organizationId: customer.organizationId,
      slug: store.slug,
      sessionVersion: customer.sessionVersion,
    },
    // An app's ticket is spent only with the verifier its WebView holds.
    { challenge: state.challenge },
  );

  const handoff = new URL('/api/storefront/auth/handoff', new URL(state.returnTo).origin);
  handoff.searchParams.set('token', ticket);
  handoff.searchParams.set('to', state.returnTo);

  /* In the app, the session cookie must be set in the app's WebView, not in
   * this sheet (they don't share cookies) — so the app is handed the handoff
   * link, adds its verifier and opens it itself. */
  const response = app ? backToApp({ to: handoff.toString() }) : NextResponse.redirect(handoff);
  // The state cookie has done its job.
  response.cookies.set(GOOGLE_STATE_COOKIE, '', { path: '/api/storefront/auth', maxAge: 0 });
  return response;
}
