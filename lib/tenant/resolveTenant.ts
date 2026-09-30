/*
 * lib/tenant/resolveTenant.ts
 *
 * Resolves a HostnameInfo (see resolveHostname.ts) into the org slug + site
 * type to route the request to. The `*.{ROOT_DOMAIN}` subdomain case is a
 * pure string operation — no DB call, exactly as cheap as the old
 * path-based slug parse. Only unrecognized hostnames (candidate custom
 * domains) hit Prisma, and only for those.
 *
 * Next.js 16 runs Proxy on the Node.js runtime by default (see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md),
 * so calling Prisma from here — unlike the old Edge-only middleware model —
 * is supported.
 */
import { prisma } from '@/lib/prisma';
import type { HostnameInfo, SiteType } from './resolveHostname';

export interface TenantResolution {
  orgSlug: string;
  siteType: Extract<SiteType, 'admin' | 'storefront'>;
  /** known when the lookup already read it (custom domains, the mobile path) */
  status?: 'ACTIVE' | 'SUSPENDED';
  /** the request arrived on the bare domain: send it to this canonical host (12.6) */
  redirectHost?: string;
}

/**
 * Verify an org slug taken from a URL path (the mobile origin routes as
 * /s/{slug}/... rather than by hostname — see proxy.ts). Mirrors the check
 * in app/store/[organizationSlug]/layout.tsx.
 */
export async function resolveTenantBySlug(slug: string): Promise<TenantResolution | null> {
  if (!slug) return null;
  // A suspended shop still resolves, so it can say it's unavailable (11.4).
  const org = await prisma.organization.findFirst({
    where: { slug, status: { in: ['ACTIVE', 'SUSPENDED'] } },
    select: { slug: true, status: true },
  });
  return org ? { orgSlug: org.slug, siteType: 'storefront', status: org.status as 'ACTIVE' | 'SUSPENDED' } : null;
}

export async function resolveTenant(info: HostnameInfo): Promise<TenantResolution | null> {
  if (info.siteType === 'admin' || info.siteType === 'storefront') {
    if (!info.subdomain) return null;
    return { orgSlug: info.subdomain, siteType: info.siteType };
  }

  if (!info.isCustomDomain) {
    return null;
  }

  /* A merchant's own domain serves the STOREFRONT only (ROADMAP 12.6): the
   * dashboard stays on the platform address, where the sign-in cookie lives.
   * `customStoreDomain` is the canonical www host; the bare domain resolves
   * too, with a redirect to it. */
  const host = info.hostname.toLowerCase();
  const org = await prisma.organization.findFirst({
    where: {
      status: { in: ['ACTIVE', 'SUSPENDED'] },
      customStoreDomain: { in: host.startsWith('www.') ? [host] : [host, `www.${host}`] },
    },
    select: { slug: true, status: true, customStoreDomain: true },
  });
  if (!org?.customStoreDomain) return null;

  const status = org.status as 'ACTIVE' | 'SUSPENDED';
  return {
    orgSlug: org.slug,
    siteType: 'storefront',
    status,
    ...(org.customStoreDomain !== host ? { redirectHost: org.customStoreDomain } : {}),
  };
}
