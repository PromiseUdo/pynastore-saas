'use server';

/*
 * features/platform/domains.ts
 *
 * The staff side of custom domains (ROADMAP 11.5): the queue of domain work
 * — register, connect, renew — oldest first against the 24-hour promise,
 * each with a checklist; marking it live or failed; recording a refund; the
 * renewals due; and the Namecheap balance — read live from Namecheap's API,
 * against what the waiting work will cost, with a hand-entered figure as the
 * fallback when Namecheap can't be reached. Platform staff only.
 *
 * Each decision is recorded on the MERCHANT's activity log (like the
 * verification queue), and the merchant is emailed.
 */
import { ownerEmails as ownerAndPaymentsEmails } from '@/lib/org-owners';
import { prisma } from '@/lib/prisma';
import { requirePlatformStaff } from '@/lib/platform-staff';
import { createAuditLog } from '@/lib/audit';
import { writePlatformAudit } from '@/lib/platform-audit';
import { SYSTEM_ROLES } from '@/lib/permissions';
import { sendPlatformNoticeEmail } from '@/lib/email';
import { getAdminUrl } from '@/lib/tenant/urls';
import { dnsTargets, checkDns, putDomainLive, type DnsCheck } from '@/lib/domains/shop-domain';
import { getAccountBalance } from '@/lib/domains/namecheap';
import { domainFailedEmail, domainLiveEmail } from '@/lib/domains/emails';
import { dnsRecordsFor, STEPS_FOR, type DnsRecord, type DomainStep } from '@/lib/domains/rules';

export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string };

export type QueueTab = 'WAITING' | 'DONE' | 'FAILED' | 'ALL';

export interface DomainQueueRow {
  id: string;
  type: 'REGISTER' | 'EXISTING' | 'RENEW';
  domain: string | null;
  status: string;
  organizationId: string;
  shopName: string;
  readyAt: Date;
  fulfilledAt: Date | null;
  /** steps ticked / steps for the kind */
  stepsDone: number;
  stepsTotal: number;
}

export interface DomainQueuePage {
  rows: DomainQueueRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: { WAITING: number; DONE: number; FAILED: number };
  renewals: { domain: string; shopName: string; organizationId: string; expiresAt: Date; renewalPaid: boolean }[];
  /** the last figure staff typed in — shown when the live read fails */
  namecheapBalance: { usd: number; updatedAt: Date } | null;
  /** read from Namecheap just now, or why it couldn't be */
  liveBalance: { availableUsd: number; accountUsd: number; fetchedAt: Date } | { error: string };
  /** what the waiting registrations and renewals will cost at Namecheap (USD, as quoted at checkout) */
  waitingCost: { usd: number; orders: number };
}

export interface DomainOrderDetail {
  id: string;
  type: 'REGISTER' | 'EXISTING' | 'RENEW';
  domain: string | null;
  canonicalHost: string | null;
  status: string;
  readyAt: Date;
  fulfilledAt: Date | null;
  steps: Record<DomainStep, Date | null>;
  expiresAt: Date | null;
  currentExpiry: Date | null;
  failureReason: string | null;
  paid: { amount: number; reference: string } | null;
  refund: { amount: number; reference: string | null; at: Date } | null;
  organization: { id: string; name: string; slug: string };
  registrant: { name: string | null; email: string | null; phone: string | null; businessName: string | null };
  dnsRecords: DnsRecord[];
}

const PAGE_SIZE = 25;

const STEP_FIELD = { registered: 'stepRegisteredAt', dns: 'stepDnsAt', host: 'stepHostAt', checked: 'stepCheckedAt' } as const;

function denied(error: unknown, fallback: string): { success: false; error: string } {
  if (error instanceof Error && error.name === 'PlatformAccessDeniedError') return { success: false, error: 'Only platform staff can do this' };
  console.error(`[platform/domains] ${fallback}:`, error);
  return { success: false, error: fallback };
}

/** Work that's due: paid for (or free, for a connection), not a free subdomain. */
const DUE = {
  type: { in: ['REGISTER', 'EXISTING', 'RENEW'] as ('REGISTER' | 'EXISTING' | 'RENEW')[] },
  OR: [{ billingTransactionId: null }, { billingTransaction: { status: 'SUCCESS' as const } }],
};

const whereFor = (tab: QueueTab) =>
  tab === 'WAITING'
    ? { ...DUE, status: 'PENDING_FULFILLMENT' as const }
    : tab === 'DONE'
      ? { ...DUE, status: 'ACTIVE' as const }
      : tab === 'FAILED'
        ? { ...DUE, status: 'FAILED' as const }
        : DUE;

/** Waiting work — the console sidebar's badge. */
export async function waitingDomainCount(): Promise<number> {
  await requirePlatformStaff();
  return prisma.domainOrder.count({ where: whereFor('WAITING') });
}

export async function listDomainQueue(params: { tab?: QueueTab; page?: number }): Promise<ActionResult<DomainQueuePage>> {
  try {
    await requirePlatformStaff();
    const tab = params.tab ?? 'WAITING';
    const page = Math.max(1, Math.floor(params.page ?? 1));
    const now = new Date();

    const [rows, total, waiting, done, failed, due, balance, live, toSpend] = await Promise.all([
      prisma.domainOrder.findMany({
        where: whereFor(tab),
        orderBy: tab === 'WAITING' ? [{ readyAt: 'asc' }, { createdAt: 'asc' }] : [{ updatedAt: 'desc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: { organization: { select: { name: true } } },
      }),
      prisma.domainOrder.count({ where: whereFor(tab) }),
      prisma.domainOrder.count({ where: whereFor('WAITING') }),
      prisma.domainOrder.count({ where: whereFor('DONE') }),
      prisma.domainOrder.count({ where: whereFor('FAILED') }),
      // Renewals: registered domains expiring within 14 days, or expired but still renewable.
      prisma.shopDomain.findMany({
        where: {
          source: 'REGISTERED',
          status: { in: ['LIVE', 'EXPIRED'] },
          expiresAt: { lte: new Date(now.getTime() + 14 * 86400_000), gte: new Date(now.getTime() - 30 * 86400_000) },
        },
        orderBy: { expiresAt: 'asc' },
        include: { organization: { select: { name: true } } },
      }),
      prisma.platformSetting.findUnique({ where: { key: 'namecheap_balance_usd' } }),
      getAccountBalance().then(
        (b) => ({ availableUsd: b.availableUsd, accountUsd: b.accountUsd, fetchedAt: b.fetchedAt }),
        (e: unknown) => ({ error: e instanceof Error ? e.message : 'Namecheap didn’t answer.' }),
      ),
      // Paid registrations and renewals not yet done at Namecheap — each will spend its quoted dollar price.
      prisma.domainOrder.aggregate({
        where: { ...whereFor('WAITING'), type: { in: ['REGISTER', 'RENEW'] }, stepRegisteredAt: null },
        _sum: { usdPrice: true },
        _count: { _all: true },
      }),
    ]);

    const paidRenewals = await prisma.domainOrder.findMany({
      where: { type: 'RENEW', status: 'PENDING_FULFILLMENT', billingTransaction: { status: 'SUCCESS' }, organizationId: { in: due.map((d) => d.organizationId) } },
      select: { organizationId: true },
    });
    const paidSet = new Set(paidRenewals.map((r) => r.organizationId));

    return {
      success: true,
      data: {
        rows: rows.map((o) => {
          const kind = o.type as 'REGISTER' | 'EXISTING' | 'RENEW';
          const steps = STEPS_FOR[kind];
          return {
            id: o.id,
            type: kind,
            domain: o.domain,
            status: o.status,
            organizationId: o.organizationId,
            shopName: o.organization.name,
            readyAt: o.readyAt ?? o.createdAt,
            fulfilledAt: o.fulfilledAt,
            stepsDone: steps.filter((st) => o[STEP_FIELD[st]]).length,
            stepsTotal: steps.length,
          };
        }),
        total,
        page,
        pageSize: PAGE_SIZE,
        counts: { WAITING: waiting, DONE: done, FAILED: failed },
        renewals: due.map((d) => ({
          domain: d.hostname,
          shopName: d.organization.name,
          organizationId: d.organizationId,
          expiresAt: d.expiresAt!,
          renewalPaid: paidSet.has(d.organizationId),
        })),
        namecheapBalance: balance ? { usd: Number(balance.value), updatedAt: balance.updatedAt } : null,
        liveBalance: live,
        waitingCost: { usd: Number(toSpend._sum.usdPrice ?? 0), orders: toSpend._count._all },
      },
    };
  } catch (error) {
    return denied(error, 'We couldn’t load the domain queue');
  }
}

export async function getDomainOrder(orderId: string): Promise<ActionResult<DomainOrderDetail | null>> {
  try {
    await requirePlatformStaff();
    const o = await prisma.domainOrder.findUnique({
      where: { id: orderId },
      include: {
        billingTransaction: { select: { amount: true, reference: true, status: true } },
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            shopDomain: true,
            paymentAccount: { select: { businessName: true, contactName: true, contactEmail: true, contactPhone: true } },
            memberships: {
              where: { status: 'ACTIVE', role: { isSystem: true, name: SYSTEM_ROLES.OWNER.name } },
              take: 1,
              select: { user: { select: { name: true, email: true } } },
            },
          },
        },
      },
    });
    if (!o || o.type === 'FREE') return { success: true, data: null };
    const account = o.organization.paymentAccount;
    const owner = o.organization.memberships[0]?.user;
    return {
      success: true,
      data: {
        id: o.id,
        type: o.type as 'REGISTER' | 'EXISTING' | 'RENEW',
        domain: o.domain,
        canonicalHost: o.domain ? `www.${o.domain}` : null,
        status: o.status,
        readyAt: o.readyAt ?? o.createdAt,
        fulfilledAt: o.fulfilledAt,
        steps: { registered: o.stepRegisteredAt, dns: o.stepDnsAt, host: o.stepHostAt, checked: o.stepCheckedAt },
        expiresAt: o.expiresAt,
        currentExpiry: o.organization.shopDomain?.expiresAt ?? null,
        failureReason: o.failureReason,
        paid: o.billingTransaction?.status === 'SUCCESS' ? { amount: Number(o.billingTransaction.amount), reference: o.billingTransaction.reference } : null,
        refund: o.refundedAt ? { amount: Number(o.refundAmount ?? 0), reference: o.refundReference, at: o.refundedAt } : null,
        organization: { id: o.organization.id, name: o.organization.name, slug: o.organization.slug },
        // The merchant is the registrant (decided): their business and payments contact (10.2), else the owner.
        registrant: {
          businessName: account?.businessName ?? o.organization.name,
          name: account?.contactName ?? owner?.name ?? null,
          email: account?.contactEmail ?? owner?.email ?? null,
          phone: account?.contactPhone ?? null,
        },
        dnsRecords: dnsRecordsFor(dnsTargets()),
      },
    };
  } catch (error) {
    return denied(error, 'We couldn’t load this order');
  }
}

/** Looks the order's domain up, so staff can see the records before ticking DNS. */
export async function checkOrderDns(orderId: string): Promise<ActionResult<DnsCheck>> {
  try {
    await requirePlatformStaff();
    const o = await prisma.domainOrder.findUnique({ where: { id: orderId }, select: { domain: true } });
    if (!o?.domain) return { success: false, error: 'This order has no domain.' };
    return { success: true, data: await checkDns(o.domain) };
  } catch (error) {
    return denied(error, 'We couldn’t check the DNS');
  }
}

/** Ticks (or unticks) one checklist step. Registering and renewing record the registrar's expiry date. */
export async function setDomainStep(
  orderId: string,
  step: DomainStep,
  done: boolean,
  expiresAt?: string,
): Promise<ActionResult> {
  try {
    const staff = await requirePlatformStaff();
    const o = await prisma.domainOrder.findUnique({ where: { id: orderId }, select: { type: true, status: true } });
    if (!o || o.type === 'FREE') return { success: false, error: 'Order not found.' };
    if (o.status !== 'PENDING_FULFILLMENT') return { success: false, error: 'This order is already finished.' };
    if (!STEPS_FOR[o.type as 'REGISTER'].includes(step)) return { success: false, error: 'That step isn’t part of this order.' };

    let expiry: Date | null | undefined;
    if (step === 'registered' && done) {
      expiry = expiresAt ? new Date(`${expiresAt}T00:00:00Z`) : null;
      if (!expiry || Number.isNaN(expiry.getTime()) || expiry.getTime() < Date.now()) {
        return { success: false, error: 'Enter the expiry date Namecheap shows — a date in the future.' };
      }
    }
    await prisma.domainOrder.update({
      where: { id: orderId },
      data: {
        [STEP_FIELD[step]]: done ? new Date() : null,
        ...(step === 'registered' ? { expiresAt: done ? expiry : null } : {}),
        handledById: staff.userId,
      },
    });
    return { success: true, data: undefined };
  } catch (error) {
    return denied(error, 'We couldn’t save that step');
  }
}


/** Every step done: the shop routes to the domain (or the renewal is recorded), and the merchant is told. */
export async function markDomainLive(orderId: string): Promise<ActionResult> {
  try {
    const staff = await requirePlatformStaff();
    const o = await prisma.domainOrder.findUnique({
      where: { id: orderId },
      include: { organization: { select: { id: true, name: true, slug: true, shopDomain: true } } },
    });
    if (!o || o.type === 'FREE' || !o.domain) return { success: false, error: 'Order not found.' };
    if (o.status !== 'PENDING_FULFILLMENT') return { success: false, error: 'This order is already finished.' };
    const kind = o.type as 'REGISTER' | 'EXISTING' | 'RENEW';
    const missing = STEPS_FOR[kind].filter((st) => !o[STEP_FIELD[st]]);
    if (missing.length) return { success: false, error: 'Tick every step on the checklist first.' };
    const shopDomain = o.organization.shopDomain;
    if (!shopDomain || shopDomain.hostname !== o.domain) {
      return { success: false, error: 'The shop no longer uses this domain — it may have been removed. Mark the order failed instead.' };
    }

    await prisma.$transaction(async (tx) => {
      await tx.domainOrder.update({ where: { id: orderId }, data: { status: 'ACTIVE', fulfilledAt: new Date(), handledById: staff.userId } });
      await putDomainLive(tx, o.organizationId, kind === 'EXISTING' ? null : o.expiresAt);
    });

    await createAuditLog({
      organizationId: o.organizationId,
      userId: staff.userId,
      action: kind === 'RENEW' ? 'platform.domain.renewed' : 'platform.domain.live',
      entityType: 'DomainOrder',
      entityId: orderId,
      metadata: { domain: o.domain, expiresAt: o.expiresAt?.toISOString() ?? null },
    });
    await sendPlatformNoticeEmail({
      to: await ownerAndPaymentsEmails(o.organizationId, { includePaymentsContact: true }),
      ...domainLiveEmail({
        shopName: o.organization.name,
        host: shopDomain.canonicalHost,
        renewed: kind === 'RENEW',
        expiresAt: kind === 'EXISTING' ? null : o.expiresAt,
        pageUrl: getAdminUrl(o.organization.slug, '/settings/domain'),
      }),
    });
    return { success: true, data: undefined };
  } catch (error) {
    return denied(error, 'We couldn’t mark it live');
  }
}

/** It can't be done: the merchant sees why. A paid order is then refunded in Paystack and recorded. */
export async function markDomainFailed(orderId: string, reason: string): Promise<ActionResult> {
  try {
    const staff = await requirePlatformStaff();
    const why = String(reason ?? '').trim();
    if (why.length < 10) return { success: false, error: 'Say what happened in a sentence — the merchant will read it.' };
    if (why.length > 1000) return { success: false, error: 'Keep the reason to 1,000 characters.' };
    const o = await prisma.domainOrder.findUnique({
      where: { id: orderId },
      include: { billingTransaction: { select: { status: true } }, organization: { select: { name: true, slug: true, shopDomain: true } } },
    });
    if (!o || o.type === 'FREE') return { success: false, error: 'Order not found.' };
    if (o.status !== 'PENDING_FULFILLMENT') return { success: false, error: 'This order is already finished.' };

    await prisma.$transaction(async (tx) => {
      await tx.domainOrder.update({ where: { id: orderId }, data: { status: 'FAILED', failureReason: why, handledById: staff.userId } });
      // A registration or connection that failed leaves the shop without that domain. A failed renewal leaves the domain as it is.
      if (o.type !== 'RENEW' && o.organization.shopDomain?.hostname === o.domain && o.organization.shopDomain.status === 'PENDING') {
        await tx.shopDomain.update({ where: { organizationId: o.organizationId }, data: { status: 'FAILED' } });
      }
    });
    await createAuditLog({
      organizationId: o.organizationId,
      userId: staff.userId,
      action: 'platform.domain.failed',
      entityType: 'DomainOrder',
      entityId: orderId,
      metadata: { domain: o.domain, reason: why },
    });
    await sendPlatformNoticeEmail({
      to: await ownerAndPaymentsEmails(o.organizationId, { includePaymentsContact: true }),
      ...domainFailedEmail({
        shopName: o.organization.name,
        domain: o.domain ?? 'your domain',
        reason: why,
        paid: o.billingTransaction?.status === 'SUCCESS',
        pageUrl: getAdminUrl(o.organization.slug, '/settings/domain'),
      }),
    });
    return { success: true, data: undefined };
  } catch (error) {
    return denied(error, 'We couldn’t mark it failed');
  }
}

/** Records a refund made in Paystack's dashboard for a failed, paid order (platform billing money, not 10.7). */
export async function recordDomainRefund(orderId: string, input: { amount: number; reference: string }): Promise<ActionResult> {
  try {
    const staff = await requirePlatformStaff();
    const o = await prisma.domainOrder.findUnique({
      where: { id: orderId },
      include: { billingTransaction: { select: { status: true, amount: true } } },
    });
    if (!o) return { success: false, error: 'Order not found.' };
    if (o.status !== 'FAILED' || o.billingTransaction?.status !== 'SUCCESS') return { success: false, error: 'Only a failed, paid order is refunded.' };
    if (o.refundedAt) return { success: false, error: 'A refund is already recorded.' };
    const amount = Number(input.amount);
    const reference = String(input.reference ?? '').trim();
    if (!Number.isFinite(amount) || amount <= 0 || amount > Number(o.billingTransaction.amount)) {
      return { success: false, error: 'Enter the amount refunded — no more than was paid.' };
    }
    if (!reference) return { success: false, error: 'Enter Paystack’s refund reference.' };

    await prisma.domainOrder.update({
      where: { id: orderId },
      data: { refundedAt: new Date(), refundAmount: amount, refundReference: reference.slice(0, 100), handledById: staff.userId },
    });
    await createAuditLog({
      organizationId: o.organizationId,
      userId: staff.userId,
      action: 'platform.domain.refunded',
      entityType: 'DomainOrder',
      entityId: orderId,
      metadata: { amount, reference },
    });
    return { success: true, data: undefined };
  } catch (error) {
    return denied(error, 'We couldn’t record the refund');
  }
}

/** The balance as staff last saw it in Namecheap — the fallback when the live read fails. */
export async function setNamecheapBalance(usd: number): Promise<ActionResult> {
  try {
    const staff = await requirePlatformStaff();
    const value = Number(usd);
    if (!Number.isFinite(value) || value < 0 || value > 1_000_000) return { success: false, error: 'Enter the balance in US dollars.' };
    const before = await prisma.platformSetting.findUnique({ where: { key: 'namecheap_balance_usd' } });
    await prisma.$transaction(async (tx) => {
      await tx.platformSetting.upsert({
        where: { key: 'namecheap_balance_usd' },
        create: { key: 'namecheap_balance_usd', value: String(value) },
        update: { value: String(value) },
      });
      await writePlatformAudit(tx, {
        userId: staff.userId,
        action: 'platform.settings.updated',
        entityType: 'PlatformSetting',
        entityId: 'namecheap_balance_usd',
        metadata: { before: { namecheapBalanceUsd: before ? Number(before.value) : null }, after: { namecheapBalanceUsd: value } },
      });
    });
    return { success: true, data: undefined };
  } catch (error) {
    return denied(error, 'We couldn’t save the balance');
  }
}
