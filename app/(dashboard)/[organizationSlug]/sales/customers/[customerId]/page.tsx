/*
 * One customer, everything about them.
 *
 * Until now a merchant could see a name in a list and nothing else — not
 * what this person has bought, not what they've spent, not whether they've
 * sent anything back. All of it already existed across orders, returns,
 * reviews and questions; this is where it comes together.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { AccessDenied } from '@/components/layout/access-denied';
import { getCustomerDetail, findMergeCandidates } from '@/features/sales/customer-detail';
import { prisma } from '@/lib/prisma';
import { getWholesaleSettings } from '@/lib/trade/accounts';
import { CustomerDetailClient } from './_components/CustomerDetailClient';
import { TradeAccountCard } from '../_components/TradeAccount';
import { AccountTermsCard } from '../_components/AccountTermsCard';
import { accountBalance } from '@/lib/trade/credit';

export const metadata: Metadata = { title: 'Customer' };

export default async function CustomerDetailPage({ params }: { params: Promise<{ customerId: string }> }) {
  await requireFeature(FEATURES.SALES_MODULE);
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;

  if (!hasPermission(perms, PERMISSIONS.CUSTOMER_VIEW)) {
    return <AccessDenied what="customers" />;
  }

  const { customerId } = await params;
  const result = await getCustomerDetail(customerId);
  if (!result.success) notFound();

  const canManage = hasPermission(perms, PERMISSIONS.CUSTOMER_EDIT);
  /* Only looked for when they could act on it. */
  const duplicates = canManage ? await findMergeCandidates(customerId) : null;

  /* Their trade account (ROADMAP 21.1), read with the shop's id as well as
   * theirs — another store's customer id finds nothing. */
  const [wholesale, trade] = await Promise.all([
    getWholesaleSettings(ctx.organization.id),
    prisma.tradeAccount.findFirst({
      where: { organizationId: ctx.organization.id, customerId },
      select: {
        status: true,
        businessName: true,
        cacNumber: true,
        requestNote: true,
        decisionReason: true,
        requestedAt: true,
        decidedAt: true,
        decidedBy: { select: { name: true, email: true } },
        onAccount: true,
        accountDays: true,
        creditLimit: true,
      },
    }),
  ]);
  /* Pay on account (ROADMAP 21.5): what they owe, orders and invoices together. */
  const [balance, shop] = trade
    ? await Promise.all([
        accountBalance(ctx.organization.id, customerId),
        prisma.organization.findUnique({ where: { id: ctx.organization.id }, select: { tradeAccountDays: true } }),
      ])
    : [null, null];
  const customer = result.data;
  const tradeCard = customer.accountDeletedAt ? null : (
    <>
    <TradeAccountCard
      customerId={customer.id}
      customerName={customer.name}
      taxId={customer.taxId}
      canSignIn={customer.hasAccount}
      hasEmail={Boolean(customer.email)}
      wholesaleOn={wholesale.mode !== 'OFF'}
      canManage={hasPermission(perms, PERMISSIONS.CUSTOMER_TRADE_MANAGE)}
      trade={
        trade && {
          status: trade.status,
          businessName: trade.businessName,
          cacNumber: trade.cacNumber,
          requestNote: trade.requestNote,
          decisionReason: trade.decisionReason,
          requestedAt: trade.requestedAt?.toISOString() ?? null,
          decidedAt: trade.decidedAt?.toISOString() ?? null,
          decidedByName: trade.decidedBy?.name ?? trade.decidedBy?.email ?? null,
        }
      }
    />
    {trade && balance && (
      <AccountTermsCard
        customerId={customer.id}
        approved={trade.status === 'APPROVED'}
        canManage={hasPermission(perms, PERMISSIONS.CUSTOMER_TRADE_MANAGE)}
        data={{
          onAccount: trade.onAccount,
          days: trade.accountDays,
          defaultDays: shop?.tradeAccountDays ?? 14,
          creditLimit: trade.creditLimit === null ? null : Number(trade.creditLimit),
          owed: balance.owed,
          overdue: balance.overdue,
          openItems: balance.items.length,
        }}
      />
    )}
    </>
  );

  return (
    <CustomerDetailClient
      customer={result.data}
      currency={ctx.organization.currency}
      canManage={canManage}
      duplicates={duplicates?.success ? duplicates.data : []}
      tradeCard={tradeCard}
    />
  );
}
