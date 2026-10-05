/*
 * Which phone app a request on the mobile origin comes from, and where it may
 * go (lib/mobile/app-config.ts, ROADMAP 16.1). Pure: the database lookup is
 * covered in mobile-store-apps.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { APP_UNAVAILABLE_PATH, appIdFromUserAgent, isValidAppId, resolveMobileRoute } from '@/lib/mobile/app-config';
import { parseAppDeepLink } from '@/lib/mobile/deep-link';
import { nextLocationAfterAuthReturn } from '@/lib/storefront/account/native-google';

const WEBVIEW_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36';

describe('appIdFromUserAgent', () => {
  it('reads the id a build appends', () => {
    expect(appIdFromUserAgent(`${WEBVIEW_UA} MansaasApp/com.pynacode.shop`)).toBe('com.pynacode.shop');
    expect(appIdFromUserAgent(`MansaasApp/com.mansaas.app`)).toBe('com.mansaas.app');
  });

  it('finds nothing in an ordinary browser, or in a malformed marker', () => {
    expect(appIdFromUserAgent(WEBVIEW_UA)).toBeNull();
    expect(appIdFromUserAgent(null)).toBeNull();
    expect(appIdFromUserAgent(`${WEBVIEW_UA} MansaasApp/`)).toBeNull();
    expect(appIdFromUserAgent(`${WEBVIEW_UA} MansaasApp/javascript:alert(1)`)).toBeNull();
    expect(appIdFromUserAgent(`${WEBVIEW_UA} NotMansaasApp/com.pynacode.shop`)).toBeNull();
  });

  it('accepts only reverse-DNS ids', () => {
    expect(isValidAppId('com.pynacode.shop')).toBe(true);
    expect(isValidAppId('shop')).toBe(false);
    expect(isValidAppId('com..shop')).toBe(false);
    expect(isValidAppId('com.pyna-code.shop')).toBe(false);
  });
});

describe('resolveMobileRoute — mall mode', () => {
  const app = { mode: 'mall', lockedSlug: null } as const;

  it('routes the root to the picker', () => {
    expect(resolveMobileRoute('/', app)).toEqual({ kind: 'picker' });
  });

  it('passes picker routes through', () => {
    expect(resolveMobileRoute('/m', app)).toEqual({ kind: 'mpath' });
    expect(resolveMobileRoute('/m/search', app)).toEqual({ kind: 'mpath' });
  });

  it('routes /s/{slug} to that storefront', () => {
    expect(resolveMobileRoute('/s/acme', app)).toEqual({ kind: 'storefront', slug: 'acme', rest: '' });
    expect(resolveMobileRoute('/s/acme/products/x', app)).toEqual({
      kind: 'storefront',
      slug: 'acme',
      rest: '/products/x',
    });
  });

  it('sends anything else home (admin block)', () => {
    expect(resolveMobileRoute('/dashboard', app)).toEqual({ kind: 'home' });
    expect(resolveMobileRoute('/login', app)).toEqual({ kind: 'home' });
  });
});

describe('resolveMobileRoute — branded mode', () => {
  const app = { mode: 'branded', lockedSlug: 'acme' } as const;

  it('opens the root straight into the locked store', () => {
    expect(resolveMobileRoute('/', app)).toEqual({ kind: 'storefront', slug: 'acme', rest: '' });
  });

  it('serves deep paths for the locked store', () => {
    expect(resolveMobileRoute('/s/acme/cart', app)).toEqual({
      kind: 'storefront',
      slug: 'acme',
      rest: '/cart',
    });
  });

  it('bounces links to any other store home', () => {
    expect(resolveMobileRoute('/s/other', app)).toEqual({ kind: 'home' });
  });

  it('has no picker', () => {
    expect(resolveMobileRoute('/m', app)).toEqual({ kind: 'home' });
    expect(resolveMobileRoute('/m/search', app)).toEqual({ kind: 'home' });
  });

  it("serves the storefront's own slug-free links from the locked store", () => {
    expect(resolveMobileRoute('/products/linen-shirt', app)).toEqual({ kind: 'storefront', slug: 'acme', rest: '/products/linen-shirt' });
    expect(resolveMobileRoute('/cart', app)).toEqual({ kind: 'storefront', slug: 'acme', rest: '/cart' });
    // An admin path stays inside the store's pages, where it doesn't exist.
    expect(resolveMobileRoute('/dashboard', app)).toEqual({ kind: 'storefront', slug: 'acme', rest: '/dashboard' });
  });

  it('can show the unavailable page, for when its store is gone', () => {
    expect(resolveMobileRoute(APP_UNAVAILABLE_PATH, app)).toEqual({ kind: 'mpath' });
  });
});

describe('resolveMobileRoute — closed app (lapsed or unregistered)', () => {
  it('shows only the unavailable page, naming the store when known', () => {
    const lapsed = { mode: 'closed', lockedSlug: 'acme' } as const;
    for (const path of ['/', '/s/acme', '/s/acme/cart', '/s/other', '/m', '/dashboard']) {
      expect(resolveMobileRoute(path, lapsed)).toEqual({ kind: 'unavailable', slug: 'acme' });
    }
    expect(resolveMobileRoute('/', { mode: 'closed', lockedSlug: null })).toEqual({ kind: 'unavailable', slug: null });
  });

  it('serves the unavailable page itself (no rewrite loop)', () => {
    expect(resolveMobileRoute(APP_UNAVAILABLE_PATH, { mode: 'closed', lockedSlug: 'acme' })).toEqual({ kind: 'mpath' });
  });
});

describe('deep links back into the app', () => {
  it('are recognised by host, whatever the app id', () => {
    expect(parseAppDeepLink('com.pynacode.shop://payment-return?ref=R1')).toMatchObject({ host: 'payment-return' });
    expect(parseAppDeepLink('com.mansaas.app://auth-return')?.params.toString()).toBe('');
    expect(parseAppDeepLink('not a link')).toBeNull();
  });
});

describe('finishing Google sign-in in the app', () => {
  const here = 'https://m.example.com/s/acme/account/sign-in?next=%2Faccount';
  const handoff = 'https://m.example.com/api/storefront/auth/handoff?token=T&to=x';
  const link = (params: Record<string, string>) =>
    `com.acme.shop://auth-return?${new URLSearchParams(params).toString()}`;

  it("opens the handoff link in the app's own WebView, with the verifier", () => {
    const next = new URL(nextLocationAfterAuthReturn(link({ to: handoff }), 'VER', here)!);
    expect(next.origin).toBe('https://m.example.com');
    expect(next.pathname).toBe('/api/storefront/auth/handoff');
    expect(next.searchParams.get('token')).toBe('T');
    expect(next.searchParams.get('verifier')).toBe('VER');
  });

  it('never follows a link to another origin or another path', () => {
    const elsewhere = 'https://evil.example.net/api/storefront/auth/handoff?token=T';
    expect(nextLocationAfterAuthReturn(link({ to: elsewhere }), 'VER', here)).toBeNull();
    const otherPath = 'https://m.example.com/s/acme/account?token=T';
    expect(nextLocationAfterAuthReturn(link({ to: otherPath }), 'VER', here)).toBeNull();
  });

  it('says so on the sign-in page when Google failed, and stays put when cancelled', () => {
    expect(new URL(nextLocationAfterAuthReturn(link({ error: 'google' }), 'VER', here)!).searchParams.get('error')).toBe(
      'google',
    );
    expect(nextLocationAfterAuthReturn(link({}), 'VER', here)).toBeNull();
    expect(nextLocationAfterAuthReturn('com.acme.shop://payment-return?ref=R', 'VER', here)).toBeNull();
  });
});
