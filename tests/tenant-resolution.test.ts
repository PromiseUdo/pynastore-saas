import { afterEach, describe, expect, it } from 'vitest';
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

  it('parses a shop.-prefixed subdomain as storefront', () => {
    expect(resolveHostname(`shop.test-company.${ROOT_DOMAIN}`)).toEqual({
      hostname: `shop.test-company.${ROOT_DOMAIN}`,
      siteType: 'storefront',
      subdomain: 'test-company',
      isCustomDomain: false,
    });
  });

  it('treats a bare "shop" subdomain as an admin site for an org literally named "shop"', () => {
    // Only shop.{slug}.{ROOT_DOMAIN} (two labels) is a storefront; shop.{ROOT_DOMAIN}
    // alone has no org label after "shop" and is just an ordinary admin subdomain.
    expect(resolveHostname(`shop.${ROOT_DOMAIN}`)).toEqual({
      hostname: `shop.${ROOT_DOMAIN}`,
      siteType: 'admin',
      subdomain: 'shop',
      isCustomDomain: false,
    });
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
        hostname: `shop.acme.${ROOT_DOMAIN}`,
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
