/*
 * lib/domains/shop-domain.ts
 *
 * A shop's own domain, on the server (ROADMAP 12.6): checking DNS, who may
 * claim a name, and taking a domain live or offline. Routing reads
 * `Organization.customStoreDomain` (the canonical www host), which is set
 * and cleared only here, so the proxy's lookup stays one indexed query.
 */
import { resolve4, resolveCname } from 'dns/promises';
import { prisma } from '@/lib/prisma';
import { forgetOrgStatus } from '@/lib/tenant/org-status';
import { canonicalHostFor, type DnsTargets } from './rules';

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Where connected domains point. Set for the host the platform runs on. */
export function dnsTargets(): DnsTargets {
  return {
    cname: (process.env.CUSTOM_DOMAIN_CNAME_TARGET || 'cname.vercel-dns.com').toLowerCase(),
    apexIp: process.env.CUSTOM_DOMAIN_APEX_IP || '76.76.21.21',
  };
}

export type RecordCheck = { ok: boolean; found: string[] };
export interface DnsCheck {
  apex: RecordCheck;
  www: RecordCheck;
  ok: boolean;
}

async function lookup<T>(f: () => Promise<T[]>): Promise<T[]> {
  try {
    return await Promise.race([f(), new Promise<T[]>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))]);
  } catch {
    return [];
  }
}

/** Looks the domain up from our side: does it point where it should? */
export async function checkDns(domain: string, targets = dnsTargets()): Promise<DnsCheck> {
  const [a, cname] = await Promise.all([lookup(() => resolve4(domain)), lookup(() => resolveCname(`www.${domain}`))]);
  const cnames = cname.map((c) => c.toLowerCase().replace(/\.$/, ''));
  const apex = { ok: a.includes(targets.apexIp), found: a };
  const www = { ok: cnames.includes(targets.cname.replace(/\.$/, '')), found: cnames };
  return { apex, www, ok: apex.ok && www.ok };
}

/** Statuses in which a domain belongs to a shop — nobody else may take it. */
const HELD = ['PENDING', 'LIVE', 'EXPIRED'] as const;

/** Whether another shop holds (or has an open order for) this domain. */
export async function domainHeldElsewhere(domain: string, organizationId: string): Promise<boolean> {
  const [held, ordered] = await Promise.all([
    prisma.shopDomain.findFirst({
      where: { hostname: domain, organizationId: { not: organizationId }, status: { in: [...HELD] } },
      select: { id: true },
    }),
    prisma.domainOrder.findFirst({
      where: {
        domain,
        organizationId: { not: organizationId },
        status: 'PENDING_FULFILLMENT',
        type: { in: ['REGISTER', 'EXISTING'] },
      },
      select: { id: true },
    }),
  ]);
  return Boolean(held || ordered);
}

/**
 * Makes this shop's record point at `domain` (a new domain replaces the
 * old row). A stale row of another shop for the same name (disconnected or
 * failed) is let go.
 */
export async function claimShopDomain(
  tx: Tx,
  input: { organizationId: string; domain: string; source: 'REGISTERED' | 'CONNECTED' },
) {
  await tx.shopDomain.deleteMany({
    where: { hostname: input.domain, organizationId: { not: input.organizationId }, status: { in: ['DISCONNECTED', 'FAILED'] } },
  });
  const data = {
    hostname: input.domain,
    canonicalHost: canonicalHostFor(input.domain),
    source: input.source,
    status: 'PENDING' as const,
    expiresAt: null,
    liveAt: null,
    dnsCheckedAt: null,
    dnsOk: false,
  };
  return tx.shopDomain.upsert({
    where: { organizationId: input.organizationId },
    create: { organizationId: input.organizationId, ...data },
    update: data,
  });
}

/** Routes the shop's storefront to its domain. */
export async function putDomainLive(tx: Tx, organizationId: string, expiresAt?: Date | null) {
  const domain = await tx.shopDomain.update({
    where: { organizationId },
    data: { status: 'LIVE', liveAt: new Date(), ...(expiresAt ? { expiresAt } : {}) },
  });
  const org = await tx.organization.update({
    where: { id: organizationId },
    data: { customStoreDomain: domain.canonicalHost },
    select: { slug: true },
  });
  forgetOrgStatus(org.slug);
  return domain;
}

/** Takes the domain out of routing; the shop answers on its platform address again. */
export async function takeDomainOffline(tx: Tx, organizationId: string, status: 'EXPIRED' | 'DISCONNECTED' | 'FAILED') {
  await tx.shopDomain.update({ where: { organizationId }, data: { status } });
  const org = await tx.organization.update({
    where: { id: organizationId },
    data: { customStoreDomain: null },
    select: { slug: true },
  });
  forgetOrgStatus(org.slug);
}
