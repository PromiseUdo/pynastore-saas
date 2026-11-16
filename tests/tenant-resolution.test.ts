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
describe('resolveHostname — production hostname model (pynastore.com)', () => {
  const PROD_ROOT = 'pynastore.com';
  const PROD_PLATFORM = 'app.pynastore.com';
  let previous: Record<string, string | undefined>;

  beforeEach(() => {
    previous = {
      root: process.env.NEXT_PUBLIC_ROOT_DOMAIN,
      platform: process.env.NEXT_PUBLIC_PLATFORM_HOST,
      mobile: process.env.NEXT_PUBLIC_MOBILE_DOMAIN,
    };
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = PROD_ROOT;
    process.env.NEXT_PUBLIC_PLATFORM_HOST = PROD_PLATFORM;
    process.env.NEXT_PUBLIC_MOBILE_DOMAIN = 'm.pynastore.com';
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = previous.root;
    process.env.NEXT_PUBLIC_PLATFORM_HOST = previous.platform;
    process.env.NEXT_PUBLIC_MOBILE_DOMAIN = previous.mobile;
  });

  it('pynastore.com is marketing', () => {
    expect(resolveHostname('pynastore.com')).toMatchObject({ siteType: 'marketing', subdomain: null });
  });

  it('www.pynastore.com is marketing', () => {
    expect(resolveHostname('www.pynastore.com')).toMatchObject({ siteType: 'marketing', subdomain: null });
  });

  it('app.pynastore.com is the platform host, not a tenant called "app"', () => {
    expect(resolveHostname('app.pynastore.com')).toEqual({
      hostname: 'app.pynastore.com',
      siteType: 'marketing',
      subdomain: null,
      isCustomDomain: false,
    });
  });

  it('demo.pynastore.com is tenant admin for demo', () => {
    expect(resolveHostname('demo.pynastore.com')).toEqual({
      hostname: 'demo.pynastore.com',
      siteType: 'admin',
      subdomain: 'demo',
      isCustomDomain: false,
    });
  });

  it('shop-demo.pynastore.com is the storefront for demo', () => {
    expect(resolveHostname('shop-demo.pynastore.com')).toEqual({
      hostname: 'shop-demo.pynastore.com',
      siteType: 'storefront',
      subdomain: 'demo',
      isCustomDomain: false,
    });
  });

  it('m.pynastore.com is the mobile origin', () => {
    expect(resolveHostname('m.pynastore.com')).toMatchObject({ siteType: 'mobile', subdomain: null });
  });

  it('m.pynastore.com is still mobile with NEXT_PUBLIC_MOBILE_DOMAIN unset', () => {
    delete process.env.NEXT_PUBLIC_MOBILE_DOMAIN;
    expect(resolveHostname('m.pynastore.com')).toMatchObject({ siteType: 'mobile' });
  });

  it('customdomain.com falls through to custom-domain resolution', () => {
    expect(resolveHostname('customdomain.com')).toEqual({
      hostname: 'customdomain.com',
      siteType: 'unknown',
      subdomain: null,
      isCustomDomain: true,
    });
  });

  it('shop.pynastore.com is admin/"shop", never the storefront of an org', () => {
    expect(resolveHostname('shop.pynastore.com')).toMatchObject({
      siteType: 'admin',
      subdomain: 'shop',
    });
  });

  /*
   * The whole point of a one-label storefront prefix: the slug after `shop-`
   * is taken verbatim, so one store's host can never be read as another's.
   */
  it('shop-demo.pynastore.com cannot resolve to any organization but demo', () => {
    expect(resolveHostname('shop-demo.pynastore.com').subdomain).toBe('demo');
    expect(resolveHostname('shop-demo-staging.pynastore.com').subdomain).toBe('demo-staging');
    expect(resolveHostname('shop-democracy.pynastore.com').subdomain).toBe('democracy');
    // An org whose own admin host looks like a storefront host is why
    // reserved-slugs.ts forbids the `shop-` prefix.
    expect(resolveHostname('shop-rite.pynastore.com')).toMatchObject({
      siteType: 'storefront',
      subdomain: 'rite',
    });
  });

  it('a tenant subdomain is not confused with the platform host', () => {
    expect(resolveHostname('apps.pynastore.com')).toMatchObject({ siteType: 'admin', subdomain: 'apps' });
    expect(resolveHostname('application.pynastore.com')).toMatchObject({
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

    // A merchant's own domain serves the storefront only (ROADMAP 12.6): the
    // dashboard stays on the platform address, where the sign-in cookie lives.
    it('never resolves a dashboard on a merchant’s domain', async () => {
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
      ).resolves.toBeNull();
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
      ).resolves.toEqual({ orgSlug: org.slug, siteType: 'storefront', status: 'ACTIVE' });
    });

    // A suspended workspace still resolves, carrying its status, so proxy.ts
    // can show "unavailable" rather than bounce the visitor away (ROADMAP 11.4).
    it('resolves a suspended organization with its status', async () => {
      const org = await prisma.organization.create({
        data: {
          name: 'Suspended Org',
          slug: `suspended-test-${suffix}`,
          customStoreDomain: `suspended-${suffix}.example.com`,
          status: 'SUSPENDED',
        },
        select: { id: true, slug: true },
      });
      createdOrgIds.push(org.id);

      await expect(
        resolveTenant({
          hostname: `suspended-${suffix}.example.com`,
          siteType: 'unknown',
          subdomain: null,
          isCustomDomain: true,
        }),
      ).resolves.toEqual({ orgSlug: org.slug, siteType: 'storefront', status: 'SUSPENDED' });
    });
  });
});
