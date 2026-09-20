/*
 * A tenant slug IS a hostname under ROOT_DOMAIN, so the names the platform
 * already answers on can never be handed to an organization.
 */
import { describe, expect, it } from 'vitest';
import { isReservedSlug, RESERVED_SLUGS } from '@/lib/tenant/reserved-slugs';
import { resolveHostname } from '@/lib/tenant/resolveHostname';

describe('isReservedSlug', () => {
  it('reserves every platform hostname label', () => {
    for (const slug of ['app', 'www', 'm', 'shop', 'api', 'admin', 'mail', 'static', 'assets']) {
      expect(isReservedSlug(slug), slug).toBe(true);
      expect(RESERVED_SLUGS.has(slug), slug).toBe(true);
    }
  });

  it('reserves anything starting with the storefront prefix', () => {
    expect(isReservedSlug('shop-rite')).toBe(true);
    expect(isReservedSlug('shop-')).toBe(true);
    expect(isReservedSlug('SHOP-Rite')).toBe(true);
  });

  it('allows ordinary slugs, including lookalikes', () => {
    for (const slug of ['demo', 'acme', 'apps', 'shopify', 'shoprite', 'my-shop', 'mail-order']) {
      expect(isReservedSlug(slug), slug).toBe(false);
    }
  });

  it('ignores case and surrounding whitespace', () => {
    expect(isReservedSlug('  APP ')).toBe(true);
    expect(isReservedSlug('')).toBe(false);
  });
});

describe('the reserved list covers every hostname the parser claims', () => {
  const ROOT = 'getnotely.io';

  it('no reserved-free slug can take a non-admin hostname', () => {
    const previousRoot = process.env.NEXT_PUBLIC_ROOT_DOMAIN;
    const previousPlatform = process.env.NEXT_PUBLIC_PLATFORM_HOST;
    const previousMobile = process.env.NEXT_PUBLIC_MOBILE_DOMAIN;
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = ROOT;
    process.env.NEXT_PUBLIC_PLATFORM_HOST = `app.${ROOT}`;
    delete process.env.NEXT_PUBLIC_MOBILE_DOMAIN;

    try {
      // Every label the parser treats as something other than tenant admin
      // must be refused as a slug, or two meanings would share one hostname.
      for (const label of ['app', 'www', 'm']) {
        expect(resolveHostname(`${label}.${ROOT}`).siteType, label).not.toBe('admin');
        expect(isReservedSlug(label), label).toBe(true);
      }
      // And a `shop-` slug would make its own admin host read as a storefront.
      expect(resolveHostname(`shop-rite.${ROOT}`)).toMatchObject({
        siteType: 'storefront',
        subdomain: 'rite',
      });
      expect(isReservedSlug('shop-rite')).toBe(true);
    } finally {
      process.env.NEXT_PUBLIC_ROOT_DOMAIN = previousRoot;
      process.env.NEXT_PUBLIC_PLATFORM_HOST = previousPlatform;
      process.env.NEXT_PUBLIC_MOBILE_DOMAIN = previousMobile;
    }
  });
});
