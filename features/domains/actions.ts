'use server';

/*
 * features/domains/actions.ts
 *
 * Settings → Domain (ROADMAP 12.6): finding and buying a `.com` or `.com.ng`
 * (22.3), claiming the plan's free `.com.ng`, renewing it,
 * connecting a domain the merchant already owns, checking its DNS, and
 * removing it. Buying and renewing are billing charges (a paid plan,
 * `billing.manage`); connecting is free and allowed during the trial
 * (decided 2026-09-30), and needs `settings.edit`. Staff do the rest from
 * the console's domain queue (11.5).
 */
import { isBusinessAppRequest, NOT_IN_THE_APP } from '@/lib/business-app/request';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS, PermissionDeniedError } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { searchDomains } from '@/lib/domains/namecheap';
import { quoteDomainNgn } from '@/lib/domains/pricing';
import { buyableDomain, domainSuggestions, ownedDomain, type BuyEnding } from '@/lib/domains/rules';
import { checkComNgMany } from '@/lib/domains/comng';
import { claimFreeComNg, freeDomainStatus, FreeDomainError } from '@/lib/domains/free-domain';
import { comNgOnSale, getComNgPricing } from '@/lib/settings';
import { checkDns, claimShopDomain, domainHeldElsewhere, takeDomainOffline, type DnsCheck } from '@/lib/domains/shop-domain';
import { notifyPendingDomainOrder } from '@/lib/domains/notify';
import { buildAndInitializeCheckout, CheckoutError } from '@/lib/billing/checkout';

type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string };

export interface DomainOffer {
  domain: string;
  priceNgn: number;
  renewNgn: number;
  /** the shop's free .com.ng covers the first year (22.3) */
  free: boolean;
}

export type DomainSearchResult =
  | { domain: string; available: true; offer: DomainOffer }
  | { domain: string; available: false; suggestions: DomainOffer[] };

function failure(error: unknown, fallback: string): { success: false; error: string } {
  if (error instanceof PermissionDeniedError) return { success: false, error: 'You don’t have permission to do this.' };
  if (error instanceof CheckoutError || error instanceof FreeDomainError) return { success: false, error: error.message };
  console.error(`[domains] ${fallback}:`, error);
  return { success: false, error: fallback };
}

async function offer(r: { domain: string; priceUsd: number; renewUsd: number }): Promise<DomainOffer> {
  const [first, renew] = await Promise.all([quoteDomainNgn(r.priceUsd), quoteDomainNgn(r.renewUsd)]);
  return { domain: r.domain, priceNgn: first.ngnPrice, renewNgn: renew.ngnPrice, free: false };
}

/** Is it free, what does it cost (first year and renewal), and if not, what's close? `.com` or `.com.ng`. */
export async function searchDomain(query: string, ending: BuyEnding = 'com'): Promise<ActionResult<DomainSearchResult>> {
  // Nothing is sold inside the business app (ROADMAP 19.3); the screens don't offer it either.
  if (await isBusinessAppRequest()) return { success: false, error: NOT_IN_THE_APP };
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_VIEW);
    const organizationId = ctx.organization.id;
    const comNg = await getComNgPricing();
    const endings: BuyEnding[] = comNgOnSale(comNg) ? ['com', 'com.ng'] : ['com'];
    const parsed = buyableDomain(String(query ?? '').slice(0, 100), endings.includes(ending) ? ending : 'com', endings);
    if (!parsed.ok) return { success: false, error: parsed.error };
    const held = await domainHeldElsewhere(parsed.domain, organizationId);

    if (parsed.domain.endsWith('.com.ng')) {
      // .com.ng: asked of the .ng registry, priced from the console (22.3).
      const free = (await freeDomainStatus(organizationId)).kind === 'available';
      const ngOffer = (domain: string): DomainOffer => ({ domain, priceNgn: comNg.registerPrice!, renewNgn: comNg.renewPrice!, free });
      const [result] = await checkComNgMany([parsed.domain]);
      if ('error' in result) return { success: false, error: 'We couldn’t check that name with the .ng registry just now. Try again in a minute.' };
      if (result.available && !held) return { success: true, data: { domain: parsed.domain, available: true, offer: ngOffer(parsed.domain) } };
      const alternatives = (await checkComNgMany(domainSuggestions(parsed.domain))).filter((r) => 'available' in r && r.available);
      return { success: true, data: { domain: parsed.domain, available: false, suggestions: alternatives.slice(0, 4).map((r) => ngOffer(r.domain)) } };
    }

    const [result] = await searchDomains([parsed.domain]);
    if (result.available && !held) {
      return { success: true, data: { domain: parsed.domain, available: true, offer: await offer(result) } };
    }
    const alternatives = (await searchDomains(domainSuggestions(parsed.domain))).filter(
      (r): r is Extract<typeof r, { available: true }> => r.available,
    );
    return {
      success: true,
      data: { domain: parsed.domain, available: false, suggestions: await Promise.all(alternatives.slice(0, 4).map(offer)) },
    };
  } catch (error) {
    return failure(error, 'We couldn’t search domains just now. Try again in a minute.');
  }
}

/**
 * Takes the plan's free .com.ng (ROADMAP 22.3): no payment — it goes
 * straight to our team, like a paid registration. Every rule is checked again
 * in lib/domains/free-domain.ts.
 */
export async function claimFreeDomain(domain: string): Promise<ActionResult<{ domain: string }>> {
  if (await isBusinessAppRequest()) return { success: false, error: NOT_IN_THE_APP };
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.BILLING_MANAGE);
    const organizationId = ctx.organization.id;
    const claimed = await claimFreeComNg(organizationId, String(domain ?? '').slice(0, 100));
    await createAuditLog({
      organizationId,
      userId: ctx.userId,
      action: 'settings.domain.free_claimed',
      entityType: 'DomainOrder',
      entityId: claimed.orderId,
      metadata: { domain: claimed.domain },
    });
    await notifyPendingDomainOrder(organizationId, { type: 'REGISTER', domain: claimed.domain });
    revalidatePath('/settings/domain');
    return { success: true, data: { domain: claimed.domain } };
  } catch (error) {
    return failure(error, 'We couldn’t take your free domain just now. Try again.');
  }
}

async function payerEmail(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user?.email) throw new CheckoutError('Your account has no email on file.');
  return user.email;
}

/** Starts paying for a new `.com`. The price is quoted again on the server before charging. */
export async function buyDomain(domain: string): Promise<ActionResult<{ authorizationUrl: string }>> {
  // Nothing is sold inside the business app (ROADMAP 19.3); the screens don't offer it either.
  if (await isBusinessAppRequest()) return { success: false, error: NOT_IN_THE_APP };
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.BILLING_MANAGE);
    const result = await buildAndInitializeCheckout({
      organizationId: ctx.organization.id,
      organizationSlug: ctx.organization.slug,
      userId: ctx.userId,
      userEmail: await payerEmail(ctx.userId),
      domainChoice: { type: 'REGISTER', domain: String(domain ?? '') },
    });
    if (!result.requiresPayment) return { success: false, error: 'There was nothing to charge.' };
    return { success: true, data: { authorizationUrl: result.authorizationUrl } };
  } catch (error) {
    return failure(error, 'We couldn’t start the payment. Try again.');
  }
}

/** Starts paying to renew the shop's registered domain for a year. */
export async function renewDomain(): Promise<ActionResult<{ authorizationUrl: string }>> {
  // Nothing is sold inside the business app (ROADMAP 19.3); the screens don't offer it either.
  if (await isBusinessAppRequest()) return { success: false, error: NOT_IN_THE_APP };
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.BILLING_MANAGE);
    const result = await buildAndInitializeCheckout({
      organizationId: ctx.organization.id,
      organizationSlug: ctx.organization.slug,
      userId: ctx.userId,
      userEmail: await payerEmail(ctx.userId),
      domainChoice: { type: 'RENEW' },
    });
    if (!result.requiresPayment) return { success: false, error: 'There was nothing to charge.' };
    return { success: true, data: { authorizationUrl: result.authorizationUrl } };
  } catch (error) {
    return failure(error, 'We couldn’t start the payment. Try again.');
  }
}

/** Starts connecting a domain the merchant owns: they add the records, then check. */
export async function connectDomain(input: string): Promise<ActionResult<{ domain: string }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_EDIT);
    const parsed = ownedDomain(String(input ?? '').slice(0, 253));
    if (!parsed.ok) return { success: false, error: parsed.error };
    const organizationId = ctx.organization.id;

    const current = await prisma.shopDomain.findUnique({ where: { organizationId }, select: { status: true, hostname: true } });
    if (current && ['PENDING', 'LIVE'].includes(current.status) && current.hostname !== parsed.domain) {
      return { success: false, error: `Your shop already has ${current.hostname}. Remove it first to use a different domain.` };
    }
    if (await domainHeldElsewhere(parsed.domain, organizationId)) {
      return { success: false, error: `${parsed.domain} is already connected to another shop. If it’s yours, contact us.` };
    }
    await prisma.$transaction((tx) => claimShopDomain(tx, { organizationId, domain: parsed.domain, source: 'CONNECTED' }));
    await createAuditLog({
      organizationId,
      userId: ctx.userId,
      action: 'settings.domain.connected',
      entityType: 'ShopDomain',
      entityId: organizationId,
      metadata: { domain: parsed.domain },
    });
    revalidatePath('/settings/domain');
    return { success: true, data: { domain: parsed.domain } };
  } catch (error) {
    return failure(error, 'We couldn’t start connecting that domain. Try again.');
  }
}

/**
 * "Check my domain": looks the records up from our side. Once they're right,
 * the domain joins the staff queue (they add it at the host so the padlock
 * certificate is issued), and the merchant sees the timeline.
 */
export async function checkMyDomain(): Promise<ActionResult<DnsCheck & { queued: boolean }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_EDIT);
    const organizationId = ctx.organization.id;
    const domain = await prisma.shopDomain.findUnique({ where: { organizationId } });
    if (!domain || domain.source !== 'CONNECTED' || !['PENDING', 'LIVE'].includes(domain.status)) {
      return { success: false, error: 'There’s no domain being connected to check.' };
    }
    const check = await checkDns(domain.hostname);
    await prisma.shopDomain.update({ where: { id: domain.id }, data: { dnsCheckedAt: new Date(), dnsOk: check.ok } });

    let queued = false;
    if (check.ok && domain.status === 'PENDING') {
      const open = await prisma.domainOrder.findFirst({
        where: { organizationId, type: 'EXISTING', domain: domain.hostname, status: 'PENDING_FULFILLMENT' },
        select: { id: true },
      });
      if (!open) {
        await prisma.domainOrder.create({
          data: {
            organizationId,
            type: 'EXISTING',
            domain: domain.hostname,
            status: 'PENDING_FULFILLMENT',
            readyAt: new Date(),
            stepDnsAt: new Date(),
          },
        });
        await notifyPendingDomainOrder(organizationId, { type: 'EXISTING', domain: domain.hostname });
      }
      queued = true;
    }
    revalidatePath('/settings/domain');
    return { success: true, data: { ...check, queued } };
  } catch (error) {
    return failure(error, 'We couldn’t check the domain just now. Try again in a minute.');
  }
}

/**
 * Removes the shop's domain: the storefront goes back to its platform
 * address at once. A registered domain stays the merchant's at the
 * registrar until it expires; we just stop using (and renewing) it.
 */
export async function removeDomain(): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_EDIT);
    const organizationId = ctx.organization.id;
    const domain = await prisma.shopDomain.findUnique({ where: { organizationId } });
    if (!domain || domain.status === 'DISCONNECTED') return { success: true, data: undefined };

    const paidInProgress = await prisma.domainOrder.findFirst({
      where: {
        organizationId,
        type: 'REGISTER',
        domain: domain.hostname,
        status: 'PENDING_FULFILLMENT',
        // Paid for, or the plan's free one (22.3): either way our team is registering it.
        OR: [{ billingTransaction: { status: 'SUCCESS' } }, { isFree: true }],
      },
      select: { id: true },
    });
    if (paidInProgress) {
      return { success: false, error: 'We’re registering this domain for you now. Contact us if you’d like to cancel it.' };
    }

    await prisma.$transaction(async (tx) => {
      await tx.domainOrder.updateMany({
        where: { organizationId, type: 'EXISTING', domain: domain.hostname, status: 'PENDING_FULFILLMENT' },
        data: { status: 'CANCELLED' },
      });
      await takeDomainOffline(tx, organizationId, 'DISCONNECTED');
    });
    await createAuditLog({
      organizationId,
      userId: ctx.userId,
      action: 'settings.domain.disconnected',
      entityType: 'ShopDomain',
      entityId: organizationId,
      metadata: { domain: domain.hostname },
    });
    revalidatePath('/settings/domain');
    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t remove the domain. Try again.');
  }
}
