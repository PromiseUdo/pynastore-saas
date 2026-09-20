/*
 * Where a shopper may be sent after signing in.
 *
 * The Google flow finishes on the root domain and then redirects to a
 * store's origin carrying a session ticket, so "is this URL really this
 * store's?" is the question standing between a working sign-in and handing
 * a live session to whoever wrote the link.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { safeNextPath, storeReturnUrl, allowedStoreHosts, storeUrl } from './return-url';

const ACME = { slug: 'acme', customStoreDomain: 'shop.acme.com' };

beforeAll(() => {
  process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'example.com';
  process.env.NEXT_PUBLIC_MOBILE_DOMAIN = 'm.example.com';
});

afterAll(() => {
  delete process.env.NEXT_PUBLIC_MOBILE_DOMAIN;
});

describe('safeNextPath', () => {
  it('keeps an ordinary path', () => {
    expect(safeNextPath('/cart')).toBe('/cart');
  });

  it('falls back for a protocol-relative path, which the browser reads as a host', () => {
    expect(safeNextPath('//evil.example')).toBe('/account');
    expect(safeNextPath('/\\evil.example')).toBe('/account');
  });

  it('falls back for an absolute URL and for nothing at all', () => {
    expect(safeNextPath('https://evil.example/pwned')).toBe('/account');
    expect(safeNextPath(null)).toBe('/account');
    expect(safeNextPath('', '/')).toBe('/');
  });
});

describe('storeReturnUrl', () => {
  it('accepts the store subdomain', () => {
    expect(storeReturnUrl('https://shop.acme.example.com/cart', ACME)).toBe(
      'https://shop.acme.example.com/cart',
    );
  });

  it('accepts the merchant custom domain', () => {
    expect(storeReturnUrl('https://shop.acme.com/account', ACME)).toBe('https://shop.acme.com/account');
  });

  it('refuses another store on the same platform', () => {
    expect(storeReturnUrl('https://shop.zed.example.com/account', ACME)).toBeNull();
  });

  it('refuses an unrelated host, including a lookalike', () => {
    expect(storeReturnUrl('https://evil.example/steal', ACME)).toBeNull();
    expect(storeReturnUrl('https://shop.acme.example.com.evil.test/x', ACME)).toBeNull();
  });

  it('refuses a non-http scheme', () => {
    expect(storeReturnUrl('javascript:alert(1)', ACME)).toBeNull();
  });

  it('on the shared mobile origin, checks the slug in the path too', () => {
    expect(storeReturnUrl('https://m.example.com/s/acme/cart', ACME)).toBe(
      'https://m.example.com/s/acme/cart',
    );
    expect(storeReturnUrl('https://m.example.com/s/zed/cart', ACME)).toBeNull();
    expect(storeReturnUrl('https://m.example.com/', ACME)).toBeNull();
  });

  it('lists exactly the hosts a store is served on', () => {
    expect(allowedStoreHosts(ACME)).toEqual([
      'shop.acme.example.com',
      'm.example.com',
      'shop.acme.com',
    ]);
  });
});

describe('storeUrl', () => {
  it('prefers the merchant custom domain', () => {
    expect(storeUrl(ACME, '/account/reset-password')).toBe(
      'https://shop.acme.com/account/reset-password',
    );
  });

  it('falls back to the platform subdomain', () => {
    expect(storeUrl({ slug: 'acme' }, '/account')).toBe('https://shop.acme.example.com/account');
  });
});
