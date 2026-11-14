/*
 * Settings → Wholesale (ROADMAP 21.1).
 *
 * Whether the shop sells to trade buyers, whether shoppers may ask for a
 * trade account, and how trade buyers may pay. Who IS a trade buyer is
 * managed in Customers, where the people are.
 */
import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { AccessDenied } from '@/components/layout/access-denied';
import { getOnlinePaymentReadiness } from '@/lib/payments/online-readiness';
import { getWholesaleSettings } from '@/lib/trade/accounts';
import { WholesaleSettingsClient } from './_components/WholesaleSettingsClient';

export const metadata: Metadata = { title: 'Wholesale' };

export default async function WholesaleSettingsPage() {
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;
  if (!hasPermission(perms, PERMISSIONS.SETTINGS_VIEW)) return <AccessDenied what="wholesale settings" />;
  const organizationId = ctx.organization.id;

  const [settings, online, bankAccounts, org, counts] = await Promise.all([
    getWholesaleSettings(organizationId),
    getOnlinePaymentReadiness(organizationId),
    prisma.merchantBankAccount.count({ where: { organizationId, isActive: true } }),
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { checkoutPayOnDelivery: true, wholesaleRequestsOpen: true, vatRegistered: true } }),
    prisma.tradeAccount.groupBy({ by: ['status'], where: { organizationId }, _count: { _all: true } }),
  ]);
  const count = (status: string) => counts.find((c) => c.status === status)?._count._all ?? 0;

  return (
    <WholesaleSettingsClient
      initial={{
        mode: settings.mode,
        // The stored choice, even while wholesale is off, so turning it back on restores it.
        requestsOpen: org.wholesaleRequestsOpen,
        tradePayOnline: settings.tradePayOnline,
        tradePayTransfer: settings.tradePayTransfer,
        tradePayOnDelivery: settings.tradePayOnDelivery,
        vatAdded: settings.vatAddedChosen,
        minOrderValue: settings.minOrderValue,
      }}
      vatRegistered={org.vatRegistered}
      offered={{ online: online.ready, transfer: bankAccounts > 0, onDelivery: org.checkoutPayOnDelivery }}
      buyers={count('APPROVED')}
      waiting={count('REQUESTED')}
      canEdit={hasPermission(perms, PERMISSIONS.SETTINGS_EDIT)}
    />
  );
}
