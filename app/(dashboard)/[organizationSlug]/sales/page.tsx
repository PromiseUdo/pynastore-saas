/*
 * Sales → the module's landing page: the few figures worth knowing, each one a
 * way into the list it counts (AGENTS §2).
 *
 * The figures come from `features/sales/overview.ts`, which counts in the
 * database. This page used to load every quote, every invoice and every
 * customer to work out four numbers.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertCircle, FileText, HelpCircle, Receipt, Users } from 'lucide-react';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { AccessDenied } from '@/components/layout/access-denied';
import { PageHeader, PageBody } from '@/components/layout/page-header';
import { StatCard, StatGrid } from '@/components/dashboard/stat-card';
import { getSalesOverview } from '@/features/sales/overview';
import { formatMoney, formatNumber } from '@/lib/format';

export const metadata: Metadata = { title: 'Sales' };

export default async function SalesDashboardPage() {
  await requireFeature(FEATURES.SALES_MODULE);
  const ctx = await getOrganizationContext();

  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW)) {
    return <AccessDenied what="sales" />;
  }

  const result = await getSalesOverview();
  if (!result.success) throw new Error(result.error);
  const overview = result.data;

  return (
    <>
      <PageHeader title="Sales" description="Customers, quotes and invoices — and what needs answering today." />

      <PageBody className="space-y-6">
        {/* A shopper asking about a product is a sale waiting on an answer,
          * and their question isn't on the store until someone gives one. */}
        {overview.unansweredQuestions > 0 && (
          <Link
            href="/sales/questions"
            className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm transition-colors hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:hover:bg-amber-950/60"
          >
            <HelpCircle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="font-medium text-foreground">
              {overview.unansweredQuestions === 1
                ? '1 customer question is waiting for an answer'
                : `${formatNumber(overview.unansweredQuestions)} customer questions are waiting for an answer`}
            </span>
            <span className="ml-auto text-muted-foreground">Answer them →</span>
          </Link>
        )}

        <StatGrid>
          <Link href="/sales/quotes" className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <StatCard
              title="Open quotes"
              value={formatNumber(overview.openQuotes)}
              description="drafted or sent, not yet decided"
              icon={FileText}
            />
          </Link>
          <Link href="/sales/invoices" className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <StatCard
              title="Unpaid total"
              value={formatMoney(overview.unpaidTotal, ctx.organization.currency)}
              description="invoiced and still owed"
              icon={Receipt}
            />
          </Link>
          {/* The invoices list has no overdue filter yet, and it already leads
              with an overdue callout — so this links there plainly rather than
              carrying a query parameter nothing reads (AGENTS §7). */}
          <Link href="/sales/invoices" className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <StatCard
              title="Overdue invoices"
              value={formatNumber(overview.overdueInvoices)}
              description="past their due date"
              icon={AlertCircle}
            />
          </Link>
          <Link href="/sales/customers" className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <StatCard title="Customers" value={formatNumber(overview.customers)} description="people who have bought" icon={Users} />
          </Link>
        </StatGrid>
      </PageBody>
    </>
  );
}
