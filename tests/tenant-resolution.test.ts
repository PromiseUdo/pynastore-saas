import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { resolveHostname } from '@/lib/tenant/resolveHostname';
import { resolveTenant } from '@/lib/tenant/resolveTenant';

// resolveHostname reads NEXT_PUBLIC_ROOT_DOMAIN at call time (no caching),
// so tests can safely assume the value configured in .env for local dev.
const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'localhost:3000';

describe('resolveHostname', () => {
  it('identifies the apex root domain as marketing', () => {
    expect(resolveHostname(ROOT_DOMAIN)).toEqual({
      hostname: ROOT_DOMAIN,
      siteType: 'marketing',
      subdomain: null,
      isCustomDomain: false,
    });
  });

  it('identifies www as marketing', () => {
    expect(resolveHostname(`www.${ROOT_DOMAIN}`)).toMatchObject({
      siteType: 'marketing',
      subdomain: null,
    });
  });

  it('identifies a missing host header as marketing', () => {
    expect(resolveHostname(null)).toMatchObject({ siteType: 'marketing' });
  });

  it('parses a tenant subdomain as admin', () => {
    expect(resolveHostname(`test-company.${ROOT_DOMAIN}`)).toEqual({
      hostname: `test-company.${ROOT_DOMAIN}`,
      siteType: 'admin',
      subdomain: 'test-company',
      isCustomDomain: false,
    });
  });

  it('parses a shop--prefixed subdomain as storefront', () => {
    expect(resolveHostname(`shop-test-company.${ROOT_DOMAIN}`)).toEqual({
      hostname: `shop-test-company.${ROOT_DOMAIN}`,
      siteType: 'storefront',
      subdomain: 'test-company',
      isCustomDomain: false,
    });
  });

  it('still parses the legacy shop.{slug} shape as storefront', () => {
    // Kept so links, bookmarks and dev hosts issued before the flattening
    // keep working. Nothing generates this shape any more.
    expect(resolveHostname(`shop.test-company.${ROOT_DOMAIN}`)).toEqual({
      hostname: `shop.test-company.${ROOT_DOMAIN}`,
      siteType: 'storefront',
      subdomain: 'test-company',
      isCustomDomain: false,
    });
  });

  it('treats a bare "shop" subdomain as an admin site, NOT a storefront', () => {
    // shop.{ROOT_DOMAIN} names no org after the prefix, so it is an ordinary
    // admin subdomain for a slug "shop" — which reserved-slugs.ts now forbids,
    // so in practice nothing resolves there. Deliberate, and pinned here.
    expect(resolveHostname(`shop.${ROOT_DOMAIN}`)).toEqual({
      hostname: `shop.${ROOT_DOMAIN}`,
      siteType: 'admin',
      subdomain: 'shop',
      isCustomDomain: false,
    });
  });

  it('names no store when the storefront prefix has no slug after it', () => {
    expect(resolveHostname(`shop-.${ROOT_DOMAIN}`)).toMatchObject({ siteType: 'marketing' });
  });

  it('is case-insensitive', () => {
    expect(resolveHostname(`Test-Company.${ROOT_DOMAIN.toUpperCase()}`)).toMatchObject({
      siteType: 'admin',
      subdomain: 'test-company',
    });
  });

  it('treats an unrecognized hostname as a candidate custom domain', () => {
    expect(resolveHostname('dashboard.acme.com')).toEqual({
      hostname: 'dashboard.acme.com',
      siteType: 'unknown',
      subdomain: null,
      isCustomDomain: true,
    });
  });
});

/*
 * The production model, pinned explicitly rather than derived from whatever
 * .env this machine has: apex + www + app. are all marketing, one label per
 * tenant surface, custom domains still fall through to the DB.
 */
describe('resolveHostname — production hostname model (getnotely.io)', () => {
  const PROD_ROOT = 'getnotely.io';
  const PROD_PLATFORM = 'app.getnotely.io';
  let previous: Record<string, string | undefined>;

  beforeEach(() => {
    previous = {
      root: process.env.NEXT_PUBLIC_ROOT_DOMAIN,
      platform: process.env.NEXT_PUBLIC_PLATFORM_HOST,
      mobile: process.env.NEXT_PUBLIC_MOBILE_DOMAIN,
    };
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = PROD_ROOT;
    process.env.NEXT_PUBLIC_PLATFORM_HOST = PROD_PLATFORM;
    process.env.NEXT_PUBLIC_MOBILE_DOMAIN = 'm.getnotely.io';
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = previous.root;
    process.env.NEXT_PUBLIC_PLATFORM_HOST = previous.platform;
    process.env.NEXT_PUBLIC_MOBILE_DOMAIN = previous.mobile;
  });

  it('getnotely.io is marketing', () => {
    expect(resolveHostname('getnotely.io')).toMatchObject({ siteType: 'marketing', subdomain: null });
  });

  it('www.getnotely.io is marketing', () => {
    expect(resolveHostname('www.getnotely.io')).toMatchObject({ siteType: 'marketing', subdomain: null });
  });

  it('app.getnotely.io is the platform host, not a tenant called "app"', () => {
    expect(resolveHostname('app.getnotely.io')).toEqual({
      hostname: 'app.getnotely.io',
      siteType: 'marketing',
      subdomain: null,
      isCustomDomain: false,
    });
  });

  it('demo.getnotely.io is tenant admin for demo', () => {
    expect(resolveHostname('demo.getnotely.io')).toEqual({
      hostname: 'demo.getnotely.io',
      siteType: 'admin',
      subdomain: 'demo',
      isCustomDomain: false,
    });
  });

  it('shop-demo.getnotely.io is the storefront for demo', () => {
    expect(resolveHostname('shop-demo.getnotely.io')).toEqual({
      hostname: 'shop-demo.getnotely.io',
      siteType: 'storefront',
      subdomain: 'demo',
      isCustomDomain: false,
    });
  });

  it('m.getnotely.io is the mobile origin', () => {
    expect(resolveHostname('m.getnotely.io')).toMatchObject({ siteType: 'mobile', subdomain: null });
  });

  it('m.getnotely.io is still mobile with NEXT_PUBLIC_MOBILE_DOMAIN unset', () => {
    delete process.env.NEXT_PUBLIC_MOBILE_DOMAIN;
    expect(resolveHostname('m.getnotely.io')).toMatchObject({ siteType: 'mobile' });
  });

  it('customdomain.com falls through to custom-domain resolution', () => {
    expect(resolveHostname('customdomain.com')).toEqual({
      hostname: 'customdomain.com',
      siteType: 'unknown',
      subdomain: null,
      isCustomDomain: true,
    });
  });

  it('shop.getnotely.io is admin/"shop", never the storefront of an org', () => {
    expect(resolveHostname('shop.getnotely.io')).toMatchObject({
      siteType: 'admin',
      subdomain: 'shop',
    });
  });

  /*
   * The whole point of a one-label storefront prefix: the slug after `shop-`
   * is taken verbatim, so one store's host can never be read as another's.
   */
  it('shop-demo.getnotely.io cannot resolve to any organization but demo', () => {
    expect(resolveHostname('shop-demo.getnotely.io').subdomain).toBe('demo');
    expect(resolveHostname('shop-demo-staging.getnotely.io').subdomain).toBe('demo-staging');
    expect(resolveHostname('shop-democracy.getnotely.io').subdomain).toBe('democracy');
    // An org whose own admin host looks like a storefront host is why
    // reserved-slugs.ts forbids the `shop-` prefix.
    expect(resolveHostname('shop-rite.getnotely.io')).toMatchObject({
      siteType: 'storefront',
      subdomain: 'rite',
    });
  });

  it('a tenant subdomain is not confused with the platform host', () => {
    expect(resolveHostname('apps.getnotely.io')).toMatchObject({ siteType: 'admin', subdomain: 'apps' });
    expect(resolveHostname('application.getnotely.io')).toMatchObject({
      siteType: 'admin',
      subdomain: 'application',
    });
  });
});

describe('resolveTenant', () => {
  it('resolves an admin subdomain to its slug with no DB call needed', async () => {
    await expect(
      resolveTenant({
        hostname: `acme.${ROOT_DOMAIN}`,
        siteType: 'admin',
        subdomain: 'acme',
        isCustomDomain: false,
      }),
    ).resolves.toEqual({ orgSlug: 'acme', siteType: 'admin' });
  });

  it('resolves a storefront subdomain to its slug', async () => {
    await expect(
      resolveTenant({
        hostname: `shop-acme.${ROOT_DOMAIN}`,
        siteType: 'storefront',
        subdomain: 'acme',
        isCustomDomain: false,
      }),
    ).resolves.toEqual({ orgSlug: 'acme', siteType: 'storefront' });
  });

  it('returns null for marketing (no tenant)', async () => {
    await expect(
      resolveTenant({ hostname: ROOT_DOMAIN, siteType: 'marketing', subdomain: null, isCustomDomain: false }),
    ).resolves.toBeNull();
  });

  it('returns null for an unregistered custom domain', async () => {
    await expect(
      resolveTenant({
        hostname: '__nonexistent-domain-test.example.com',
        siteType: 'unknown',
        subdomain: null,
        isCustomDomain: true,
      }),
    ).resolves.toBeNull();
  });

  describe('with a registered custom domain', () => {
    const createdOrgIds: string[] = [];
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    afterEach(async () => {
      while (createdOrgIds.length) {
        const id = createdOrgIds.pop()!;
        await prisma.organization.deleteMany({ where: { id } });
      }
    });

    it('resolves a customAdminDomain to its org slug', async () => {
      const org = await prisma.organization.create({
        data: {
          name: 'Custom Domain Test Org',
          slug: `custom-domain-test-${suffix}`,
          customAdminDomain: `dashboard-${suffix}.example.com`,
        },
        select: { id: true, slug: true },
      });
      createdOrgIds.push(org.id);

      await expect(
        resolveTenant({
          hostname: `dashboard-${suffix}.example.com`,
          siteType: 'unknown',
          subdomain: null,
          isCustomDomain: true,
        }),
      ).resolves.toEqual({ orgSlug: org.slug, siteType: 'admin' });
    });

    it('resolves a customStoreDomain to its org slug', async () => {
      const org = await prisma.organization.create({
        data: {
          name: 'Custom Store Domain Test Org',
          slug: `custom-store-test-${suffix}`,
          customStoreDomain: `shop-${suffix}.example.com`,
        },
        select: { id: true, slug: true },
      });
      createdOrgIds.push(org.id);

      await expect(
        resolveTenant({
          hostname: `shop-${suffix}.example.com`,
          siteType: 'unknown',
          subdomain: null,
          isCustomDomain: true,
        }),
      ).resolves.toEqual({ orgSlug: org.slug, siteType: 'storefront' });
    });

    it('ignores a suspended organization', async () => {
      const org = await prisma.organization.create({
        data: {
          name: 'Suspended Org',
          slug: `suspended-test-${suffix}`,
          customAdminDomain: `suspended-${suffix}.example.com`,
          status: 'SUSPENDED',
        },
        select: { id: true },
      });
      createdOrgIds.push(org.id);

      await expect(
        resolveTenant({
          hostname: `suspended-${suffix}.example.com`,
          siteType: 'unknown',
          subdomain: null,
          isCustomDomain: true,
        }),
      ).resolves.toBeNull();
    });
  });
});
