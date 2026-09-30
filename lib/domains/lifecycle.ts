/*
 * lib/domains/lifecycle.ts
 *
 * The daily domain job (ROADMAP 12.6 / 11.5), run from
 * app/api/cron/domain-lifecycle:
 *   1. a registered domain past its expiry comes out of routing (EXPIRED) —
 *      the shop answers on its platform address again;
 *   2. renewal reminders to the owner and the payments contact: 30, 14, 7,
 *      3 and 1 day(s) before the renewal deadline, on the expiry day, and
 *      weekly while it can still be renewed — each once (DomainReminder),
 *      and none once the merchant has paid to renew;
 *   3. a morning list for staff: what's due in 14 days, paid or not.
 */
import { prisma } from '@/lib/prisma';
import { Prisma } from '@/lib/generated/prisma/client';
import { sendPlatformNoticeEmail } from '@/lib/email';
import { getAdminUrl, getMarketingUrl } from '@/lib/tenant/urls';
import { SYSTEM_ROLES } from '@/lib/permissions';
import { getTldPriceUsd } from './namecheap';
import { quoteDomainNgn } from './pricing';
import { reminderDue, GRACE_DAYS } from './rules';
import { takeDomainOffline } from './shop-domain';
import { renewalReminderEmail, staffRenewalDigest } from './emails';

const DAY = 24 * 60 * 60 * 1000;

async function renewPriceNgn(domain: string): Promise<number | null> {
  try {
    return (await quoteDomainNgn(await getTldPriceUsd(domain.split('.').slice(1).join('.'), 'renew'))).ngnPrice;
  } catch {
    return null; // Namecheap unreachable: the email simply leaves the price out.
  }
}

export async function runDomainLifecycle(options: { now?: Date; only?: string[] } = {}) {
  const now = options.now ?? new Date();
  const scope = options.only ? { organizationId: { in: options.only } } : {};
  const result = { expired: 0, reminders: 0, failed: 0, digest: false };

  // 1. Expire.
  const expiring = await prisma.shopDomain.findMany({
    where: { ...scope, source: 'REGISTERED', status: 'LIVE', expiresAt: { lte: now } },
    select: { organizationId: true },
  });
  for (const d of expiring) {
    await prisma.$transaction((tx) => takeDomainOffline(tx, d.organizationId, 'EXPIRED'));
    result.expired += 1;
  }

  // 2. Reminders — while it can still be renewed at the normal price.
  const due = await prisma.shopDomain.findMany({
    where: {
      ...scope,
      source: 'REGISTERED',
      status: { in: ['LIVE', 'EXPIRED'] },
      expiresAt: { not: null, gte: new Date(now.getTime() - GRACE_DAYS * DAY), lte: new Date(now.getTime() + 45 * DAY) },
      organization: { status: 'ACTIVE' },
    },
    include: { organization: { select: { name: true, slug: true, paymentAccount: { select: { contactEmail: true } } } } },
  });
  const renewedPaid = new Set(
    (
      await prisma.domainOrder.findMany({
        where: { type: 'RENEW', status: 'PENDING_FULFILLMENT', billingTransaction: { status: 'SUCCESS' }, organizationId: { in: due.map((d) => d.organizationId) } },
        select: { organizationId: true },
      })
    ).map((r) => r.organizationId),
  );
  const owners = await prisma.membership.findMany({
    where: { organizationId: { in: due.map((d) => d.organizationId) }, status: 'ACTIVE', role: { isSystem: true, name: SYSTEM_ROLES.OWNER.name } },
    select: { organizationId: true, user: { select: { email: true } } },
  });

  for (const d of due) {
    if (renewedPaid.has(d.organizationId) || !d.expiresAt) continue;
    const kind = reminderDue(d.expiresAt, now);
    if (!kind) continue;
    let claimId: string;
    try {
      claimId = (await prisma.domainReminder.create({ data: { shopDomainId: d.id, kind }, select: { id: true } })).id;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue;
      throw error;
    }
    const to = [
      ...new Set([
        ...owners.filter((o) => o.organizationId === d.organizationId).map((o) => o.user.email),
        ...(d.organization.paymentAccount?.contactEmail ? [d.organization.paymentAccount.contactEmail] : []),
      ]),
    ];
    const sent = await sendPlatformNoticeEmail({
      to,
      ...renewalReminderEmail({
        shopName: d.organization.name,
        domain: d.hostname,
        expiresAt: d.expiresAt,
        renewNgn: await renewPriceNgn(d.hostname),
        pageUrl: getAdminUrl(d.organization.slug, '/settings/domain'),
        kind: kind.split(':')[0],
      }),
    });
    if (sent) result.reminders += 1;
    else {
      result.failed += 1;
      await prisma.domainReminder.delete({ where: { id: claimId } }).catch(() => {});
    }
  }

  // 3. The staff list — only on the full run, not a scoped (test) one.
  const staffTo = process.env.PLATFORM_ADMIN_EMAIL;
  if (!options.only && staffTo) {
    const soon = due.filter((d) => d.expiresAt && d.expiresAt.getTime() <= now.getTime() + 14 * DAY);
    if (soon.length) {
      const item = (d: (typeof soon)[number]) => ({ shop: d.organization.name, domain: d.hostname, expiresAt: d.expiresAt! });
      result.digest = await sendPlatformNoticeEmail({
        to: staffTo,
        ...staffRenewalDigest({
          renewedAwaitingUs: soon.filter((d) => renewedPaid.has(d.organizationId)).map(item),
          notRenewed: soon.filter((d) => !renewedPaid.has(d.organizationId)).map(item),
          queueUrl: getMarketingUrl('/platform/domains'),
        }),
      });
    }
  }
  return result;
}
