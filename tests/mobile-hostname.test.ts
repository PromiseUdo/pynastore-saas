import { describe, expect, it } from 'vitest';
import { resolveHostname } from '@/lib/tenant/resolveHostname';

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'localhost:3000';

describe('resolveHostname — mobile origin', () => {
  it('recognizes the m.{ROOT_DOMAIN} shape as the mobile host', () => {
    expect(resolveHostname(`m.${ROOT_DOMAIN}`)).toEqual({
      hostname: `m.${ROOT_DOMAIN}`,
      siteType: 'mobile',
      subdomain: null,
      isCustomDomain: false,
    });
  });

  it('recognizes an explicit NEXT_PUBLIC_MOBILE_DOMAIN', () => {
    const prev = process.env.NEXT_PUBLIC_MOBILE_DOMAIN;
    process.env.NEXT_PUBLIC_MOBILE_DOMAIN = 'm.acme-shop.app';
    try {
      expect(resolveHostname('m.acme-shop.app')).toMatchObject({ siteType: 'mobile' });
    } finally {
      process.env.NEXT_PUBLIC_MOBILE_DOMAIN = prev;
    }
  });

  it('does not treat a normal tenant subdomain as mobile', () => {
    expect(resolveHostname(`acme.${ROOT_DOMAIN}`)).toMatchObject({ siteType: 'admin' });
    expect(resolveHostname(`shop.acme.${ROOT_DOMAIN}`)).toMatchObject({ siteType: 'storefront' });
  });

  it('falls back to mobile for an unrecognized host in development (LAN IP live reload)', () => {
    const prev = process.env.NODE_ENV;
    // @ts-expect-error - writable in tests
    process.env.NODE_ENV = 'development';
    try {
      expect(resolveHostname('192.168.1.42:3000')).toMatchObject({ siteType: 'mobile' });
    } finally {
      // @ts-expect-error - restore
      process.env.NODE_ENV = prev;
    }
  });

  it('outside development, an unrecognized host stays a candidate custom domain', () => {
    expect(resolveHostname('dashboard.acme.com')).toMatchObject({
      siteType: 'unknown',
      isCustomDomain: true,
    });
  });
});

describe('proxy mobile path routing', () => {
  const STOREFRONT = /^\/s\/([^/]+)(\/.*)?$/;

  it('extracts slug + rest from /s/{slug}/...', () => {
    expect('/s/acme'.match(STOREFRONT)?.slice(1, 3)).toEqual(['acme', undefined]);
    expect('/s/acme/products/123'.match(STOREFRONT)?.slice(1, 3)).toEqual([
      'acme',
      '/products/123',
    ]);
  });

  it('does not match admin-style paths', () => {
    expect('/dashboard'.match(STOREFRONT)).toBeNull();
    expect('/acme/inventory'.match(STOREFRONT)).toBeNull();
  });
});
