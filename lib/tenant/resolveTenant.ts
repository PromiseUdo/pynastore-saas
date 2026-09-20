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
}

/**
 * Verify an org slug taken from a URL path (the mobile origin routes as
 * /s/{slug}/... rather than by hostname — see proxy.ts). Mirrors the check
 * in app/store/[organizationSlug]/layout.tsx.
 */
export async function resolveTenantBySlug(slug: string): Promise<TenantResolution | null> {
  if (!slug) return null;
  const org = await prisma.organization.findFirst({
    where: { slug, status: 'ACTIVE' },
    select: { slug: true },
  });
  return org ? { orgSlug: org.slug, siteType: 'storefront' } : null;
}

export async function resolveTenant(info: HostnameInfo): Promise<TenantResolution | null> {
  if (info.siteType === 'admin' || info.siteType === 'storefront') {
    if (!info.subdomain) return null;
    return { orgSlug: info.subdomain, siteType: info.siteType };
  }

  if (!info.isCustomDomain) {
    return null;
  }

  const org = await prisma.organization.findFirst({
    where: {
      status: 'ACTIVE',
      OR: [{ customAdminDomain: info.hostname }, { customStoreDomain: info.hostname }],
    },
    select: { slug: true, customAdminDomain: true, customStoreDomain: true },
  });

  if (!org) return null;

  if (org.customAdminDomain === info.hostname) {
    return { orgSlug: org.slug, siteType: 'admin' };
  }
  if (org.customStoreDomain === info.hostname) {
    return { orgSlug: org.slug, siteType: 'storefront' };
  }

  return null;
}
