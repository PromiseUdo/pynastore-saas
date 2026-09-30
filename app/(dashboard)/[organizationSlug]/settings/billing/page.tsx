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
import { CYCLES, type BillingCycleKey } from '@/lib/billing/plans';
import { CancelSubscriptionButton } from './_components/CancelSubscriptionButton';
import { formatDate, formatMoney } from '@/lib/format';
import type { AccessState } from '@/lib/billing/access';

export const metadata: Metadata = { title: 'Billing' };

/** What the workspace's plan means right now, as a badge (ROADMAP 12.1). */
const ACCESS_BADGE: Record<AccessState, { label: string; variant: 'success' | 'info' | 'warning' | 'destructive' | 'muted' }> = {
  active: { label: 'Active', variant: 'success' },
  trial: { label: 'Free trial', variant: 'info' },
  grace: { label: 'Ended — shop still open', variant: 'warning' },
  lapsed: { label: 'Ended — shop closed', variant: 'destructive' },
  none: { label: 'No plan', variant: 'muted' },
};

const cycleLabel = (cycle: string | null | undefined) =>
  cycle && Object.hasOwn(CYCLES, cycle) ? CYCLES[cycle as BillingCycleKey].label.toLowerCase() : null;

export default async function BillingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const { checkout } = await searchParams;
  const ctx = await getOrganizationContext();
  const { plan, access, subscription } = await getOrganizationEntitlements();
  const paying = subscription?.status === 'ACTIVE' || subscription?.status === 'PAST_DUE';
  const canManageBilling = hasPermission(ctx.membership.role.permissions, PERMISSIONS.BILLING_MANAGE);

  const transactions = await prisma.billingTransaction.findMany({
    where: { organizationId: ctx.organization.id, status: 'SUCCESS' },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: ctx.organization.id },
    select: { customStoreDomain: true },
  });

  const badge = ACCESS_BADGE[access.state];
  const hasPlan = plan.id !== null;

  return (
    <>
      <PageHeader
        title="Billing"
        description="Manage your workspace's subscription and payment history."
        actions={
          <Link href="/upgrade" className={buttonVariants({ size: 'sm', variant: 'outline' })}>
            {paying ? 'Change plan' : 'Choose a plan'}
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
                  <h2 className="text-base font-semibold text-foreground">
                    {hasPlan ? `${plan.name} plan` : 'No plan yet'}
                  </h2>
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </div>

                <p className="mt-3 text-xs text-muted-foreground">
                  {access.state === 'trial' && access.trialEndsAt
                    ? `Your free trial ends on ${formatDate(access.trialEndsAt)}. Nothing is charged unless you choose a plan.`
                    : access.state === 'grace' && access.graceEndsAt
                      ? `Your plan has ended. Your shop keeps taking orders until ${formatDate(access.graceEndsAt)}.`
                      : access.state === 'lapsed'
                        ? 'Your plan has ended and your shop is closed to customers. Choosing a plan reopens it straight away.'
                        : access.state === 'none'
                          ? 'Choose a plan to get started.'
                          : subscription?.currentPeriodEnd
                            ? `${subscription.cancelAtPeriodEnd ? 'Ends' : 'Renews'} on ${formatDate(subscription.currentPeriodEnd)}${
                                subscription.amount !== null && cycleLabel(subscription.billingCycle)
                                  ? ` · ${formatMoney(subscription.amount)}, billed ${cycleLabel(subscription.billingCycle)}`
                                  : ''
                              }`
                            : null}
                </p>
                {access.state === 'active' && subscription?.status === 'PAST_DUE' && (
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                    Your last renewal didn&apos;t go through. Paystack will try your card again.
                  </p>
                )}
              </div>

              {canManageBilling && paying && access.state === 'active' && subscription && !subscription.cancelAtPeriodEnd && (
                <CancelSubscriptionButton />
              )}
            </div>
          </div>

          <Link
            href="/settings/domain"
            className="flex items-center justify-between gap-4 rounded-lg border bg-card p-5 shadow-xs transition-colors hover:bg-muted/40"
          >
            <div>
              <h2 className="text-sm font-semibold text-foreground">Your web address</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {organization.customStoreDomain
                  ? `Your shop is at ${organization.customStoreDomain}.`
                  : 'Use your own domain, like yourshop.com, for your shop.'}{' '}
                Managed in Settings → Domain.
              </p>
            </div>
            <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </Link>

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
                          {formatDate(tx.createdAt)}
                        </TableCell>
                        <TableCell>{tx.planName ?? '—'}</TableCell>
                        <TableCell muted>{tx.type === 'CHECKOUT' ? 'New plan' : 'Renewal'}</TableCell>
                        <TableCell align="right" className="font-medium tabular-nums">
                          {formatMoney(Number(tx.amount))}
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
