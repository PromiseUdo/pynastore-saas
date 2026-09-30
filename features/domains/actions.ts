'use server';

/*
 * features/domains/actions.ts
 *
 * Settings → Domain (ROADMAP 12.6): finding and buying a `.com`, renewing it,
 * connecting a domain the merchant already owns, checking its DNS, and
 * removing it. Buying and renewing are billing charges (a paid plan,
 * `billing.manage`); connecting is free and allowed during the trial
 * (decided 2026-09-30), and needs `settings.edit`. Staff do the rest from
 * the console's domain queue (11.5).
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS, PermissionDeniedError } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { searchDomains } from '@/lib/domains/namecheap';
import { quoteDomainNgn } from '@/lib/domains/pricing';
import { comDomain, comSuggestions, ownedDomain } from '@/lib/domains/rules';
import { checkDns, claimShopDomain, domainHeldElsewhere, takeDomainOffline, type DnsCheck } from '@/lib/domains/shop-domain';
import { notifyPendingDomainOrder } from '@/lib/domains/notify';
import { buildAndInitializeCheckout, CheckoutError } from '@/lib/billing/checkout';

type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string };

export interface DomainOffer {
  domain: string;
  priceNgn: number;
  renewNgn: number;
}

export type DomainSearchResult =
  | { domain: string; available: true; offer: DomainOffer }
  | { domain: string; available: false; suggestions: DomainOffer[] };

function failure(error: unknown, fallback: string): { success: false; error: string } {
  if (error instanceof PermissionDeniedError) return { success: false, error: 'You don’t have permission to do this.' };
  if (error instanceof CheckoutError) return { success: false, error: error.message };
  console.error(`[domains] ${fallback}:`, error);
  return { success: false, error: fallback };
}

async function offer(r: { domain: string; priceUsd: number; renewUsd: number }): Promise<DomainOffer> {
  const [first, renew] = await Promise.all([quoteDomainNgn(r.priceUsd), quoteDomainNgn(r.renewUsd)]);
  return { domain: r.domain, priceNgn: first.ngnPrice, renewNgn: renew.ngnPrice };
}

/** Is this `.com` free, what does it cost (first year and renewal), and if not, what's close? */
export async function searchComDomain(query: string): Promise<ActionResult<DomainSearchResult>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_VIEW);
    const parsed = comDomain(String(query ?? '').slice(0, 100));
    if (!parsed.ok) return { success: false, error: parsed.error };

    const [result] = await searchDomains([parsed.domain]);
    const held = await domainHeldElsewhere(parsed.domain, ctx.organization.id);
    if (result.available && !held) {
      return { success: true, data: { domain: parsed.domain, available: true, offer: await offer(result) } };
    }
    const alternatives = (await searchDomains(comSuggestions(parsed.domain))).filter(
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

async function payerEmail(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user?.email) throw new CheckoutError('Your account has no email on file.');
  return user.email;
}

/** Starts paying for a new `.com`. The price is quoted again on the server before charging. */
export async function buyDomain(domain: string): Promise<ActionResult<{ authorizationUrl: string }>> {
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
      where: { organizationId, type: 'REGISTER', domain: domain.hostname, status: 'PENDING_FULFILLMENT', billingTransaction: { status: 'SUCCESS' } },
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
