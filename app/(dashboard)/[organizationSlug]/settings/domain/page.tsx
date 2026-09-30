/*
 * Settings → Domain (ROADMAP 12.6): the shop's own web address. Buy a `.com`
 * (a paid plan), or connect one the merchant owns (allowed on the trial);
 * follow it to live; renew it; remove it. The domain serves the storefront
 * only — the dashboard stays on the platform address.
 */
import type { Metadata } from 'next';
import { PageBody, PageHeader } from '@/components/layout/page-header';
import { AccessDenied } from '@/components/layout/access-denied';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { getOrganizationEntitlements } from '@/lib/billing/entitlements';
import { getStorefrontUrl } from '@/lib/tenant/urls';
import { dnsTargets } from '@/lib/domains/shop-domain';
import { dnsRecordsFor } from '@/lib/domains/rules';
import { getTldPriceUsd } from '@/lib/domains/namecheap';
import { quoteDomainNgn } from '@/lib/domains/pricing';
import { DomainClient, type DomainPageData } from './DomainClient';

export const metadata: Metadata = { title: 'Domain' };

export default async function DomainSettingsPage() {
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;
  if (!hasPermission(perms, PERMISSIONS.SETTINGS_VIEW)) return <AccessDenied what="your domain settings" />;
  const organizationId = ctx.organization.id;

  const [domain, { access, subscription }] = await Promise.all([
    prisma.shopDomain.findUnique({ where: { organizationId } }),
    getOrganizationEntitlements(),
  ]);
  const [order, renewalPaid] = await Promise.all([
    domain
      ? prisma.domainOrder.findFirst({
          where: {
            organizationId,
            domain: domain.hostname,
            type: { in: ['REGISTER', 'EXISTING', 'RENEW'] },
            OR: [{ billingTransactionId: null }, { billingTransaction: { status: 'SUCCESS' } }],
          },
          orderBy: { createdAt: 'desc' },
          include: { billingTransaction: { select: { status: true } } },
        })
      : null,
    domain
      ? prisma.domainOrder.count({
          where: { organizationId, type: 'RENEW', status: 'PENDING_FULFILLMENT', billingTransaction: { status: 'SUCCESS' } },
        })
      : 0,
  ]);

  let renewNgn: number | null = null;
  if (domain?.source === 'REGISTERED') {
    try {
      renewNgn = (await quoteDomainNgn(await getTldPriceUsd(domain.hostname.split('.').slice(1).join('.'), 'renew'))).ngnPrice;
    } catch {
      renewNgn = null; // Namecheap unreachable: the page says the price isn't available right now.
    }
  }

  const data: DomainPageData = {
    platformUrl: getStorefrontUrl(ctx.organization.slug),
    domain: domain
      ? {
          hostname: domain.hostname,
          canonicalHost: domain.canonicalHost,
          source: domain.source,
          status: domain.status,
          expiresAt: domain.expiresAt,
          dnsOk: domain.dnsOk,
          dnsCheckedAt: domain.dnsCheckedAt,
        }
      : null,
    order: order
      ? {
          type: order.type as 'REGISTER' | 'EXISTING' | 'RENEW',
          status: order.status,
          readyAt: order.readyAt ?? order.createdAt,
          stepRegisteredAt: order.stepRegisteredAt,
          stepDnsAt: order.stepDnsAt,
          stepHostAt: order.stepHostAt,
          fulfilledAt: order.fulfilledAt,
          failureReason: order.failureReason,
          paid: order.billingTransaction?.status === 'SUCCESS',
          refundedAt: order.refundedAt,
        }
      : null,
    renewalPaid: renewalPaid > 0,
    renewNgn,
    records: dnsRecordsFor(dnsTargets()),
    paidPlan: access.state === 'active' && (subscription?.status === 'ACTIVE' || subscription?.status === 'PAST_DUE'),
    canBuy: hasPermission(perms, PERMISSIONS.BILLING_MANAGE),
    canConnect: hasPermission(perms, PERMISSIONS.SETTINGS_EDIT),
  };

  return (
    <>
      <PageHeader
        title="Domain"
        description="Your shop’s own web address, like yourshop.com. It opens your shop; your dashboard stays at its current address."
      />
      <PageBody>
        <DomainClient data={data} />
      </PageBody>
    </>
  );
}
