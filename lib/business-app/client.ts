'use client';

/*
 * lib/business-app/client.ts
 *
 * The business app's trips outside its WebView (ROADMAP 19.2). The app can
 * only stay on the business host, and Google, Apple and Facebook all refuse
 * to sign anyone in inside an embedded WebView. So those run in the in-app
 * browser sheet (@capacitor/browser) and come back by deep link — the same
 * pattern the shopper apps use for payments and Google (16.1).
 *
 * Everything here is a no-op outside the business app: `inBusinessApp()` is
 * false in every browser, including a phone browser on the business host.
 */
import { isNativePlatform } from '@/lib/platform';
import { parseAppDeepLink } from '@/lib/mobile/deep-link';
import { signInWithGoogleInApp } from '@/lib/storefront/account/native-google';
import { getMarketingUrl, onBusinessHost } from '@/lib/tenant/urls';
import { BUSINESS_SIGN_IN_HANDOFF, BUSINESS_SIGN_IN_START, type BusinessSignInProvider } from './paths';

/**
 * A notification's page in the business app: /o/{slug}/{path} on this host
 * (lib/notifications/links.ts businessAppPathFor). Anything else is refused.
 */
export function isBusinessEntryPath(path: string): boolean {
  return /^\/o\/[a-z0-9][a-z0-9-]*(?:\/[^/\\]|$|\?)/.test(path) && !path.includes('//');
}

/** True only inside the business app (native, on the business host). */
export function inBusinessApp(): boolean {
  return isNativePlatform() && onBusinessHost();
}

/**
 * Sign in with Google or Apple from the app: the provider runs in the sheet
 * on the platform host, and the finished sign-in comes back as a ticket the
 * WebView spends with its verifier (lib/business-app/tickets.ts). `next` is
 * the page on the business host to land on.
 */
export async function signInInBusinessApp(provider: BusinessSignInProvider, next: string): Promise<void> {
  const start = new URL(getMarketingUrl(BUSINESS_SIGN_IN_START));
  start.searchParams.set('provider', provider);
  start.searchParams.set('next', next);
  await signInWithGoogleInApp(start.toString(), BUSINESS_SIGN_IN_HANDOFF);
}

/**
 * Open a page in the sheet until it deep-links back to `returnHost`.
 * Resolves with that link's parameters, or null when the sheet was closed by
 * hand (nothing happened).
 */
export async function openSheetUntilReturn(url: string, returnHost: string): Promise<URLSearchParams | null> {
  const [{ Browser }, { App }] = await Promise.all([import('@capacitor/browser'), import('@capacitor/app')]);
  return new Promise((resolve) => {
    const handles: Promise<{ remove: () => Promise<void> }>[] = [];
    let done = false;
    const finish = (params: URLSearchParams | null) => {
      if (done) return;
      done = true;
      for (const handle of handles) void handle.then((h) => h.remove());
      // Not supported on Android (the deep link already brought the app forward).
      void Browser.close().catch(() => {});
      resolve(params);
    };
    handles.push(Browser.addListener('browserFinished', () => finish(null)));
    handles.push(
      App.addListener('appUrlOpen', ({ url: link }) => {
        const parsed = parseAppDeepLink(link);
        if (parsed?.host === returnHost) finish(parsed.params);
      }),
    );
    void Browser.open({ url, presentationStyle: 'fullscreen' });
  });
}

/**
 * A page returned by deep link, if it is on THIS origin — a deep link is a
 * URL from outside the app, so it may only ever move the app around its
 * own host.
 */
export function sameOriginTarget(raw: string | null, current: string = window.location.href): string | null {
  if (!raw) return null;
  try {
    const target = new URL(raw, current);
    return target.origin === new URL(current).origin ? target.toString() : null;
  } catch {
    return null;
  }
}

/**
 * What the app does with a tapped link, or null to let it be:
 *   - `sheet`: it leaves this host — open it in the sheet on top of the app;
 *   - `here`: it's this host's own page but asks for a new tab, which an app
 *     doesn't have — open it in the app (the sheet has no session).
 * Only http(s): `mailto:`, `tel:` and the like are the phone's to handle.
 */
export function externalLinkTarget(
  href: string,
  target: string,
  current: string,
): { open: 'sheet' | 'here'; url: string } | null {
  let url: URL;
  try {
    url = new URL(href, current);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.origin !== new URL(current).origin) return { open: 'sheet', url: url.toString() };
  return target === '_blank' ? { open: 'here', url: url.toString() } : null;
}

/** Open a page that isn't the app's own in the sheet, on top of the app. */
export async function openExternal(url: string): Promise<void> {
  const { Browser } = await import('@capacitor/browser');
  await Browser.open({ url, presentationStyle: 'popover' });
}

export interface PendingTab {
  /** show this page in the tab (in the app: in the sheet) */
  go(url: string): void;
  close(): void;
}

/**
 * A new tab opened NOW, while this is still the click (a window opened after
 * an await is a pop-up most browsers block), to be pointed at a page once
 * the server has made its link. Cut off from this page (no `opener`).
 * In the business app there are no tabs: the page opens in the sheet.
 * Null when the browser blocked the tab.
 */
export function openPendingTab(): PendingTab | null {
  if (inBusinessApp()) return { go: (url) => void openExternal(url), close: () => {} };
  const tab = window.open('about:blank', '_blank');
  if (!tab) return null;
  // (`noopener` would make window.open return null, so the link is cut by hand.)
  tab.opener = null;
  return {
    go: (url) => {
      tab.location.href = url;
    },
    close: () => tab.close(),
  };
}
