import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { PageHeader, PageBody } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button-variants';
import {
  Table,
  TableWrapper,
  TableHead,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from '@/components/ui/table';
import { getOrganizationContext } from '@/lib/organization';
import { getOrganizationEntitlements } from '@/lib/billing/entitlements';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { PLANS } from '@/lib/billing/plans';
import { formatNaira } from '@/lib/billing/format';
import { getRootDomain } from '@/lib/tenant/resolveHostname';
import { CancelSubscriptionButton } from './_components/CancelSubscriptionButton';
import { DomainSettingsCard } from './_components/DomainSettingsCard';

export const metadata: Metadata = { title: 'Billing' };

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'destructive' | 'muted'> = {
  ACTIVE: 'success',
  PAST_DUE: 'warning',
  CANCELED: 'destructive',
  INCOMPLETE: 'muted',
};

export default async function BillingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const { checkout } = await searchParams;
  const ctx = await getOrganizationContext();
  const { plan, subscription } = await getOrganizationEntitlements();
  const canManageBilling = hasPermission(ctx.membership.role.permissions, PERMISSIONS.BILLING_MANAGE);

  const transactions = await prisma.billingTransaction.findMany({
    where: { organizationId: ctx.organization.id, status: 'SUCCESS' },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  const [organization, pendingDomainOrder] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: ctx.organization.id },
      select: { customAdminDomain: true, customStoreDomain: true },
    }),
    prisma.domainOrder.findFirst({
      where: { organizationId: ctx.organization.id, status: 'PENDING_FULFILLMENT' },
      orderBy: { createdAt: 'desc' },
      select: { type: true, domain: true },
    }),
  ]);

  const planConfig = PLANS[plan];

  return (
    <>
      <PageHeader
        title="Billing"
        description="Manage your workspace's subscription and payment history."
        actions={
          <Link href="/upgrade" className={buttonVariants({ size: 'sm', variant: 'outline' })}>
            Change plan
            <ArrowUpRight className="size-3.5" />
          </Link>
        }
      />

      <PageBody>
        <div className="space-y-6">
          {checkout === 'success' && (
            <div className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">
              Payment successful — your plan has been updated.
            </div>
          )}
          {checkout === 'failed' && (
            <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-400">
              We couldn&apos;t confirm that payment. If you were charged, contact support.
            </div>
          )}

          {/* Current plan card */}
          <div className="rounded-lg border bg-card p-5 shadow-xs">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-foreground">{planConfig.name} plan</h2>
                  {subscription && (
                    <Badge variant={STATUS_VARIANT[subscription.status] ?? 'muted'}>
                      {subscription.status.replace('_', ' ')}
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{planConfig.tagline}</p>

                {subscription?.currentPeriodEnd && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {subscription.cancelAtPeriodEnd ? 'Access ends' : 'Renews'} on{' '}
                    {new Date(subscription.currentPeriodEnd).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                    {subscription.billingCycle && ` · Billed ${subscription.billingCycle.toLowerCase()}`}
                  </p>
                )}
              </div>

              {canManageBilling && plan !== 'FREE' && subscription && !subscription.cancelAtPeriodEnd && (
                <CancelSubscriptionButton />
              )}
            </div>
          </div>

          <DomainSettingsCard
            orgSlug={ctx.organization.slug}
            rootDomain={getRootDomain()}
            canManageBilling={canManageBilling}
            isPaidPlan={plan !== 'FREE'}
            customAdminDomain={organization.customAdminDomain}
            customStoreDomain={organization.customStoreDomain}
            pendingDomainOrder={
              pendingDomainOrder
                ? { type: pendingDomainOrder.type as 'EXISTING' | 'REGISTER', domain: pendingDomainOrder.domain }
                : null
            }
          />

          {/* Payment history */}
          <div className="flex flex-col gap-0 rounded-lg border bg-card shadow-xs">
            <div className="border-b px-5 py-4">
              <h2 className="text-sm font-semibold text-foreground">Payment history</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Successful charges to this workspace
              </p>
            </div>

            {transactions.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                No payments yet.
              </p>
            ) : (
              <TableWrapper flush>
                <Table>
                  <TableHead>
                    <tr>
                      <TableColumnHeader>Date</TableColumnHeader>
                      <TableColumnHeader>Plan</TableColumnHeader>
                      <TableColumnHeader>Type</TableColumnHeader>
                      <TableColumnHeader align="right">Amount</TableColumnHeader>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {transactions.map((tx) => (
                      <TableRow key={tx.id}>
                        <TableCell muted>
                          {tx.createdAt.toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </TableCell>
                        <TableCell>{PLANS[tx.plan].name}</TableCell>
                        <TableCell muted>{tx.type === 'CHECKOUT' ? 'Upgrade' : 'Renewal'}</TableCell>
                        <TableCell align="right" className="font-medium tabular-nums">
                          {formatNaira(Number(tx.amount))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableWrapper>
            )}
          </div>
        </div>
      </PageBody>
    </>
  );
}
