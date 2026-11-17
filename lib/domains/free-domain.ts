/*
 * lib/domains/free-domain.ts
 *
 * The free .com.ng (ROADMAP 22.3, agreed 2026-11-17): a shop whose plan
 * includes it (FEATURES.FREE_DOMAIN — Growth and Business to start) and
 * which pays YEARLY gets one .com.ng registered free for its first year.
 *   - Paid, not trialling: the subscription is ACTIVE on the yearly cycle,
 *     so it only becomes available after the first yearly payment.
 *   - One per shop, ever (Organization.freeDomainClaimedAt, claimed with a
 *     conditional update). Changing plan or cycle later doesn't earn another.
 *     Only a registration staff couldn't complete gives the claim back.
 *   - First year only: renewing is the normal .com.ng renewal price, paid by
 *     the shop through the usual reminders.
 *   - Offered only while .com.ng is on sale (both prices set).
 */
import { prisma } from '@/lib/prisma';
import { FEATURES } from '@/lib/billing/plans';
import { comNgOnSale, getComNgPricing } from '@/lib/settings';
import { claimShopDomain, domainHeldElsewhere } from './shop-domain';
import { buyableDomain } from './rules';
import { checkComNg } from './comng';

export type FreeDomainStatus =
  /** can claim one now */
  | { kind: 'available' }
  /** the plan includes it, but the shop pays monthly or every 6 months */
  | { kind: 'not_yearly' }
  /** already taken (or being registered) */
  | { kind: 'claimed' }
  /** no free domain: not on the plan, a trial, lapsed, or .com.ng isn't on sale */
  | { kind: 'none' };

export async function freeDomainStatus(organizationId: string): Promise<FreeDomainStatus> {
  const [org, pricing] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        freeDomainClaimedAt: true,
        subscription: {
          select: { status: true, billingCycle: true, plan: { select: { features: { where: { feature: FEATURES.FREE_DOMAIN }, select: { feature: true } } } } },
        },
      },
    }),
    getComNgPricing(),
  ]);
  const sub = org?.subscription;
  if (!org || !comNgOnSale(pricing) || !sub || sub.status !== 'ACTIVE' || !sub.plan?.features.length) return { kind: 'none' };
  if (org.freeDomainClaimedAt) return { kind: 'claimed' };
  if (sub.billingCycle !== 'YEARLY') return { kind: 'not_yearly' };
  return { kind: 'available' };
}

/** A failure the merchant can read as it is. */
export class FreeDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FreeDomainError';
  }
}

/**
 * Takes the shop's free .com.ng: it becomes the shop's (pending) domain and
 * joins the staff queue, with nothing to pay. Every rule is checked here, on
 * the server, whatever the page showed.
 */
export async function claimFreeComNg(organizationId: string, input: string): Promise<{ domain: string; orderId: string }> {
  const status = await freeDomainStatus(organizationId);
  if (status.kind === 'claimed') throw new FreeDomainError('Your shop has already used its free .com.ng.');
  if (status.kind === 'not_yearly') throw new FreeDomainError('The free .com.ng comes with yearly billing. Switch to paying yearly to get it.');
  if (status.kind !== 'available') throw new FreeDomainError('Your plan doesn’t include a free .com.ng.');

  const parsed = buyableDomain(input, 'com.ng', ['com.ng']);
  if (!parsed.ok) throw new FreeDomainError(parsed.error);
  const domain = parsed.domain;

  const current = await prisma.shopDomain.findUnique({ where: { organizationId }, select: { status: true, hostname: true } });
  if (current && ['PENDING', 'LIVE'].includes(current.status)) {
    throw new FreeDomainError(`Your shop already has ${current.hostname}. Remove it first to use a different domain.`);
  }
  if (await domainHeldElsewhere(domain, organizationId)) throw new FreeDomainError(`${domain} is already being set up for another shop.`);
  const check = await checkComNg(domain);
  if ('error' in check) throw new FreeDomainError('We couldn’t check that name with the .ng registry just now. Try again in a minute.');
  if (!check.available) throw new FreeDomainError(`${domain} is taken — please search again.`);

  const now = new Date();
  const orderId = await prisma.$transaction(async (tx) => {
    // The claim itself: whoever gets here second finds it already set.
    const claimed = await tx.organization.updateMany({
      where: { id: organizationId, freeDomainClaimedAt: null },
      data: { freeDomainClaimedAt: now },
    });
    if (claimed.count === 0) throw new FreeDomainError('Your shop has already used its free .com.ng.');
    const order = await tx.domainOrder.create({
      data: {
        organizationId,
        type: 'REGISTER',
        domain,
        status: 'PENDING_FULFILLMENT',
        isFree: true,
        ngnPrice: 0,
        readyAt: now,
      },
      select: { id: true },
    });
    await claimShopDomain(tx, { organizationId, domain, source: 'REGISTERED' });
    return order.id;
  });
  return { domain, orderId };
}
