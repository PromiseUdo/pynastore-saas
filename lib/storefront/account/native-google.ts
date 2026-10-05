'use client';

/*
 * lib/storefront/account/native-google.ts
 *
 * "Continue with Google" inside the phone app (ROADMAP 16.1).
 *
 * Google refuses to sign anyone in inside an app's embedded WebView, so on
 * the web this is a plain link (./google-link.ts) and in the app it runs in
 * the in-app browser sheet (@capacitor/browser), like payments:
 *
 *   app ──▶ sheet: /google/start?…&app={appId}&challenge=…
 *             └─▶ Google ─▶ /google/callback
 *                   └─▶ {appId}://auth-return?to={handoff link}   (deep link)
 *   app ◀── closes the sheet, opens the handoff link in its own WebView
 *           with &verifier=…, which sets the session cookie THERE
 *
 * The sheet and the WebView don't share cookies, which is why the WebView
 * must open the handoff link itself. The verifier stays in this closure; the
 * ticket that crosses the deep link is useless without it, so another app
 * that registered the same scheme gains nothing by catching the link.
 */
import { parseAppDeepLink } from '@/lib/mobile/deep-link';

const AUTH_RETURN_HOST = 'auth-return';
const HANDOFF_PATH = '/api/storefront/auth/handoff';

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function newVerifier(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

/**
 * Where to go once the sheet hands back, or null to stay put. Only a handoff
 * link on THIS origin is followed — a deep link is a URL from outside the app.
 */
export function nextLocationAfterAuthReturn(
  deepLink: string,
  verifier: string,
  current: string,
): string | null {
  const link = parseAppDeepLink(deepLink);
  if (!link || link.host !== AUTH_RETURN_HOST) return null;

  if (link.params.get('error')) {
    const here = new URL(current);
    here.searchParams.set('error', 'google');
    return here.toString();
  }

  const to = link.params.get('to');
  if (!to) return null; // cancelled on Google's screen: stay on the page

  let handoff: URL;
  try {
    handoff = new URL(to);
  } catch {
    return null;
  }
  if (handoff.origin !== new URL(current).origin || handoff.pathname !== HANDOFF_PATH) return null;

  handoff.searchParams.set('verifier', verifier);
  return handoff.toString();
}

export async function signInWithGoogleInApp(startHref: string): Promise<void> {
  const [{ Browser }, { App }] = await Promise.all([import('@capacitor/browser'), import('@capacitor/app')]);

  const [{ id: appId }, { verifier, challenge }] = await Promise.all([App.getInfo(), newVerifier()]);

  const start = new URL(startHref);
  start.searchParams.set('app', appId);
  start.searchParams.set('challenge', challenge);

  const handles: { remove: () => Promise<void> }[] = [];
  let finished = false;

  const finish = (next: string | null) => {
    if (finished) return;
    finished = true;
    for (const handle of handles) void handle.remove();
    // Not supported on Android (the deep link already brought the app forward).
    void Browser.close().catch(() => {});
    if (next) window.location.assign(next);
  };

  // Closed by hand: nothing happened, stay where we are.
  handles.push(await Browser.addListener('browserFinished', () => finish(null)));
  handles.push(
    await App.addListener('appUrlOpen', ({ url }) => {
      if (parseAppDeepLink(url)?.host !== AUTH_RETURN_HOST) return;
      finish(nextLocationAfterAuthReturn(url, verifier, window.location.href));
    }),
  );

  await Browser.open({ url: start.toString(), presentationStyle: 'fullscreen' });
}
