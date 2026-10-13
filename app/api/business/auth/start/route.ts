/*
 * GET /api/business/auth/start?provider=google|apple&challenge=…&next=…
 *
 * The business app's staff sign-in, step 1 of 3 (ROADMAP 19.2). Opened in
 * the app's in-app browser sheet, on the platform host — where Auth.js and
 * its Google and Apple callbacks live. Remembers the app's challenge and
 * where to land, then starts the provider's sign-in.
 *
 *   sheet: start ─▶ Google/Apple ─▶ /api/auth/callback/… ─▶ finish
 *          finish ─▶ com.mansaas.business://auth-return?to={handoff}
 *   app:   opens the handoff link with its verifier ─▶ signed in
 */
import { NextResponse } from 'next/server';
import { signIn } from '@/lib/auth';
import { appleSignInConfigured } from '@/lib/apple-sign-in';
import { isValidChallenge } from '@/lib/business-app/tickets';
import { BUSINESS_SIGN_IN_FINISH, isBusinessSignInProvider } from '@/lib/business-app/paths';
import { SIGN_IN_COOKIE, sealSignInState, signInCookieOptions } from '@/lib/business-app/sign-in-cookie';
import { safeBusinessPath } from '@/lib/tenant/business';
import { isLocalHostname, resolveHostname } from '@/lib/tenant/resolveHostname';
import { getMarketingUrl } from '@/lib/tenant/urls';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get('host') ?? '';

  // Auth.js keeps its own state cookies on the platform host, so this must run there.
  if (resolveHostname(host).siteType !== 'marketing') {
    const there = new URL(getMarketingUrl(url.pathname));
    there.search = url.search;
    return NextResponse.redirect(there);
  }

  const provider = url.searchParams.get('provider');
  const challenge = url.searchParams.get('challenge');
  if (!isBusinessSignInProvider(provider) || !isValidChallenge(challenge)) {
    return new NextResponse('This sign-in link isn’t valid. Close this window and try again.', { status: 400 });
  }
  if (provider === 'apple' && !appleSignInConfigured()) {
    return new NextResponse('Sign in with Apple isn’t available yet. Close this window and try another way.', { status: 404 });
  }

  const state = await sealSignInState({ challenge, next: safeBusinessPath(url.searchParams.get('next') || '/') });
  // Auth.js writes its own cookies (state, PKCE, nonce) through next/headers; they ride on this response.
  const providerUrl = await signIn(provider, { redirectTo: getMarketingUrl(BUSINESS_SIGN_IN_FINISH), redirect: false });

  const response = NextResponse.redirect(providerUrl);
  response.cookies.set(SIGN_IN_COOKIE, state, signInCookieOptions(!isLocalHostname(host) && process.env.NODE_ENV === 'production'));
  return response;
}
