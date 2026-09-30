/*
 * lib/tenant/org-status.ts
 *
 * Whether a workspace is active, suspended or deleted — read by proxy.ts on
 * every tenant request, which is where suspension is enforced (ROADMAP 11.4):
 * a suspended admin opens only the "suspended" page, and a suspended
 * storefront shows only that it's unavailable.
 *
 * Subdomain requests otherwise resolve without the database, so this is the
 * one lookup they add; it's kept for a few seconds per slug, per server
 * instance. A suspension or restore therefore takes effect everywhere within
 * CACHE_MS — the data layer's own `status: 'ACTIVE'` filters (the org
 * context, the catalogue, order placement) close the gap in between.
 */
import { prisma } from '@/lib/prisma';

export type OrgStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED';

const CACHE_MS = 15_000;

export interface OrgRouting {
  status: OrgStatus | null;
  /** the shop's live custom domain (canonical host), if any — ROADMAP 12.6 */
  customStoreDomain: string | null;
}

const cache = new Map<string, { routing: OrgRouting; at: number }>();

/** How a workspace routes: its status and its live custom domain. */
export async function getOrgRouting(slug: string, now = Date.now()): Promise<OrgRouting> {
  const hit = cache.get(slug);
  if (hit && now - hit.at < CACHE_MS) return hit.routing;
  const org = await prisma.organization.findUnique({ where: { slug }, select: { status: true, customStoreDomain: true } });
  const routing: OrgRouting = {
    status: (org?.status as OrgStatus | undefined) ?? null,
    customStoreDomain: org?.customStoreDomain ?? null,
  };
  cache.set(slug, { routing, at: now });
  if (cache.size > 5_000) cache.delete(cache.keys().next().value as string);
  return routing;
}

/** The workspace's status, or null if there is no such workspace. */
export async function getOrgStatus(slug: string, now = Date.now()): Promise<OrgStatus | null> {
  return (await getOrgRouting(slug, now)).status;
}

/** Drops a cached status or domain — called after either changes, for this instance at least. */
export function forgetOrgStatus(slug: string): void {
  cache.delete(slug);
}
