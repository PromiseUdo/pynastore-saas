/*
 * GET /api/social/meta/app-start?ticket=…
 *
 * "Connect Facebook" from the business app (ROADMAP 19.2). Opened in the
 * app's in-app browser sheet — Meta won't run its dialog inside an embedded
 * WebView — on the platform host, where the callback lives.
 *
 * The sheet has no session and none of the WebView's cookies, so it arrives
 * with a one-minute, single-use ticket the signed-in member minted
 * (startSocialConnect with `inApp`). Spending it here stands in for the
 * session check; the nonce is armed in THIS browser, and the state is
 * marked `app` so the callback answers by deep link. The callback still
 * re-reads the member's permission before anything is written.
 */
import { NextResponse } from 'next/server';
import { consumeAppTicket } from '@/lib/business-app/tickets';
import { metaRedirectUri } from '@/lib/social/config';
import { getProvider, isProviderKey, primaryPlatform } from '@/lib/social/registry';
import { createNonce, encodeState, STATE_COOKIE, stateCookieOptions } from '@/lib/social/state';
import { getRootDomain, isLocalHostname } from '@/lib/tenant/resolveHostname';

export const dynamic = 'force-dynamic';

const expired = () =>
  new NextResponse('This link has expired. Close this window and press Connect again.', {
    status: 400,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });

export async function GET(request: Request) {
  const claims = await consumeAppTicket('social-connect', new URL(request.url).searchParams.get('ticket'));
  if (!claims) return expired();

  const { organizationId, userId, provider: providerKey, returnTo } = claims;
  if (typeof organizationId !== 'string' || typeof userId !== 'string' || typeof returnTo !== 'string') return expired();
  if (typeof providerKey !== 'string' || !isProviderKey(providerKey)) return expired();
  const provider = getProvider(providerKey);
  if (!provider.isConfigured()) return expired();

  const nonce = createNonce();
  const state = encodeState({ organizationId, userId, nonce, provider: primaryPlatform(providerKey), returnTo, app: true });

  const root = getRootDomain();
  const response = NextResponse.redirect(provider.buildAuthorizationUrl({ state, redirectUri: metaRedirectUri() }));
  response.cookies.set(STATE_COOKIE, nonce, stateCookieOptions(root, !isLocalHostname(root)));
  return response;
}
