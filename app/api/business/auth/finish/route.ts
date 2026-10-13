/*
 * GET /api/business/auth/finish
 *
 * The business app's staff sign-in, step 2 of 3 (ROADMAP 19.2). Still in
 * the sheet, on the platform host: Auth.js has just signed the person in
 * HERE, in the sheet's own cookies — which the app's WebView can't see. So
 * that sign-in becomes a one-minute ticket bound to the app's challenge,
 * the sheet is signed out again (nothing stays behind in it), and the app
 * is handed the link that spends the ticket on the business host.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { auth, signOut } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { BUSINESS_APP_ID } from '@/lib/mobile/app-config';
import { appDeepLink, deepLinkPage } from '@/lib/mobile/deep-link-page';
import { mintAppTicket } from '@/lib/business-app/tickets';
import { AUTH_RETURN_HOST, BUSINESS_SIGN_IN_HANDOFF } from '@/lib/business-app/paths';
import { SIGN_IN_COOKIE, SIGN_IN_COOKIE_PATH, openSignInState } from '@/lib/business-app/sign-in-cookie';
import { getBusinessUrl } from '@/lib/tenant/urls';

export async function GET() {
  const jar = await cookies();
  const state = await openSignInState(jar.get(SIGN_IN_COOKIE)?.value);
  const session = await auth();
  const userId = session?.user?.id;

  // Always back to THE business app — never to a scheme a request names.
  const back = (params: Record<string, string>) =>
    deepLinkPage({ heading: 'Signing you in', deepLink: appDeepLink(BUSINESS_APP_ID, AUTH_RETURN_HOST, params) });

  let response: NextResponse;
  const user = userId ? await prisma.user.findUnique({ where: { id: userId }, select: { id: true, sessionVersion: true } }) : null;
  if (!state || !user) {
    response = back({ error: 'sign-in' });
  } else {
    const ticket = await mintAppTicket('sign-in', { userId: user.id, sessionVersion: user.sessionVersion }, { challenge: state.challenge });
    const handoff = new URL(getBusinessUrl(BUSINESS_SIGN_IN_HANDOFF));
    handoff.searchParams.set('token', ticket);
    handoff.searchParams.set('next', state.next);
    response = back({ to: handoff.toString() });
  }

  // Nothing stays signed in inside the sheet. (Its session cookie is the shared .{root} one.)
  if (userId) await signOut({ redirect: false });
  response.cookies.set(SIGN_IN_COOKIE, '', { path: SIGN_IN_COOKIE_PATH, maxAge: 0 });
  return response;
}
