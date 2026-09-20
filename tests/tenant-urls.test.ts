/*
 * The URLs the application hands to browsers, mail and OAuth providers.
 *
 * Pinned against the production hostname model rather than whatever .env this
 * machine carries, because a wrong value here doesn't fail loudly — it sends
 * a real person to a host that doesn't exist.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getAdminUrl, getMarketingUrl, getMobileStorefrontUrl, getMobileUrl, getStorefrontUrl } from '@/lib/tenant/urls';
import { storeUrl } from '@/lib/storefront/account/return-url';
import { metaRedirectUri } from '@/lib/social/config';

describe('production URL generation (getnotely.io)', () => {
  let previous: Record<string, string | undefined>;

  beforeEach(() => {
    previous = {
      root: process.env.NEXT_PUBLIC_ROOT_DOMAIN,
      platform: process.env.NEXT_PUBLIC_PLATFORM_HOST,
      mobile: process.env.NEXT_PUBLIC_MOBILE_DOMAIN,
      meta: process.env.META_REDIRECT_URI,
    };
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'getnotely.io';
    process.env.NEXT_PUBLIC_PLATFORM_HOST = 'app.getnotely.io';
    process.env.NEXT_PUBLIC_MOBILE_DOMAIN = 'm.getnotely.io';
    delete process.env.META_REDIRECT_URI;
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = previous.root;
    process.env.NEXT_PUBLIC_PLATFORM_HOST = previous.platform;
    process.env.NEXT_PUBLIC_MOBILE_DOMAIN = previous.mobile;
    if (previous.meta === undefined) delete process.env.META_REDIRECT_URI;
    else process.env.META_REDIRECT_URI = previous.meta;
  });

  it('sends sign-in, invitations and callbacks to the platform host', () => {
    expect(getMarketingUrl('/login')).toBe('https://app.getnotely.io/login');
    expect(getMarketingUrl('/invite/abc123')).toBe('https://app.getnotely.io/invite/abc123');
    expect(getMarketingUrl('/')).toBe('https://app.getnotely.io/');
    expect(metaRedirectUri()).toBe('https://app.getnotely.io/api/social/meta/callback');
  });

  it('sends a tenant admin link to {slug}.getnotely.io', () => {
    expect(getAdminUrl('demo', '/dashboard')).toBe('https://demo.getnotely.io/dashboard');
    expect(getAdminUrl('demo', '/sales/orders/1')).toBe('https://demo.getnotely.io/sales/orders/1');
  });

  it('sends a storefront link to shop-{slug}.getnotely.io', () => {
    expect(getStorefrontUrl('demo', '/products/example')).toBe(
      'https://shop-demo.getnotely.io/products/example',
    );
    expect(getStorefrontUrl('demo')).toBe('https://shop-demo.getnotely.io/');
  });

  it('keeps the mobile origin and its /s/{slug} paths', () => {
    expect(getMobileUrl('/')).toBe('https://m.getnotely.io/');
    expect(getMobileStorefrontUrl('demo', '/cart')).toBe('https://m.getnotely.io/s/demo/cart');
  });

  it('prefers a merchant custom domain over the platform storefront host', () => {
    expect(storeUrl({ slug: 'demo', customStoreDomain: 'shop.demo.com' }, '/account')).toBe(
      'https://shop.demo.com/account',
    );
    expect(storeUrl({ slug: 'demo' }, '/account')).toBe('https://shop-demo.getnotely.io/account');
  });

  it('respects an explicit META_REDIRECT_URI', () => {
    process.env.META_REDIRECT_URI = 'https://tunnel.example/api/social/meta/callback';
    expect(metaRedirectUri()).toBe('https://tunnel.example/api/social/meta/callback');
  });
});

describe('local development is unchanged when no platform host is set', () => {
  let previous: Record<string, string | undefined>;

  beforeEach(() => {
    previous = {
      root: process.env.NEXT_PUBLIC_ROOT_DOMAIN,
      platform: process.env.NEXT_PUBLIC_PLATFORM_HOST,
    };
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'app.localhost:3000';
    delete process.env.NEXT_PUBLIC_PLATFORM_HOST;
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = previous.root;
    if (previous.platform === undefined) delete process.env.NEXT_PUBLIC_PLATFORM_HOST;
    else process.env.NEXT_PUBLIC_PLATFORM_HOST = previous.platform;
  });

  it('falls back to the root domain over http', () => {
    expect(getMarketingUrl('/login')).toBe('http://app.localhost:3000/login');
    expect(getAdminUrl('demo', '/dashboard')).toBe('http://demo.app.localhost:3000/dashboard');
    expect(getStorefrontUrl('demo', '/cart')).toBe('http://shop-demo.app.localhost:3000/cart');
  });
});
