/*
 * A trade buyer's statement (ROADMAP 21.5), to print or save as PDF and send
 * them: what they owe this shop, orders on account and invoices together.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { AccessDenied } from '@/components/layout/access-denied';
import { prisma } from '@/lib/prisma';
import { accountBalance } from '@/lib/trade/credit';
import { AccountStatementDocument } from '@/components/sales/account-statement-document';

export const metadata: Metadata = { title: 'Statement' };

export default async function StatementPage({ params }: { params: Promise<{ customerId: string }> }) {
  const ctx = await getOrganizationContext();
  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.CUSTOMER_VIEW)) {
    return <AccessDenied what="customers" />;
  }
  const { customerId } = await params;
  const organizationId = ctx.organization.id;

  const [customer, org, bankAccounts] = await Promise.all([
    prisma.customer.findFirst({
      where: { id: customerId, organizationId },
      select: { name: true, email: true, phone: true, taxId: true, tradeAccount: { select: { businessName: true } } },
    }),
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, logoUrl: true, businessAddress: true, supportEmail: true, supportPhone: true, vatNumber: true, currency: true },
    }),
    prisma.merchantBankAccount.findMany({
      where: { organizationId, isActive: true },
      select: { bankName: true, accountName: true, accountNumber: true },
    }),
  ]);
  if (!customer || !org) notFound();

  const asOf = new Date();
  const balance = await accountBalance(organizationId, customerId, asOf);

  return (
    <AccountStatementDocument
      from={{
        name: org.name,
        logoUrl: org.logoUrl,
        address: org.businessAddress,
        supportEmail: org.supportEmail,
        supportPhone: org.supportPhone,
        extra: org.vatNumber ? [`VAT number ${org.vatNumber}`] : [],
      }}
      to={{
        businessName: customer.tradeAccount?.businessName ?? customer.name,
        contactName: customer.name,
        email: customer.email,
        phone: customer.phone,
        taxId: customer.taxId,
      }}
      balance={balance}
      currency={org.currency}
      bankAccounts={bankAccounts}
      asOf={asOf}
    />
  );
}
