/*
 * Sales → Customers.
 *
 * Who you sell to, and what they're worth. Search, segment, sort and the
 * page number live in the URL (AGENTS §3) and are applied by the database —
 * the figures on each row are aggregates over their orders, so filtering or
 * sorting by them in the browser would mean downloading every customer and
 * every order first (features/sales/customer-insights.ts).
 */
import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { AccessDenied } from '@/components/layout/access-denied';
import { listCustomerInsights } from '@/features/sales/customer-insights';
import { CustomersPageClient } from './_components/CustomersPageClient';

export const metadata: Metadata = { title: 'Customers' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value || undefined;
}

export default async function CustomersPage({ searchParams }: { searchParams: SearchParams }) {
  await requireFeature(FEATURES.SALES_MODULE);
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;

  if (!hasPermission(perms, PERMISSIONS.CUSTOMER_VIEW)) {
    return <AccessDenied what="customers" />;
  }

  const raw = await searchParams;
  const page = Number(one(raw.page));
  const result = await listCustomerInsights({
    q: one(raw.q),
    segment: one(raw.segment),
    sort: one(raw.sort),
    page: Number.isFinite(page) && page > 0 ? page : 1,
  });
  if (!result.success) throw new Error(result.error);

  return (
    <CustomersPageClient
      list={result.data}
      currency={ctx.organization.currency}
      canManage={hasPermission(perms, PERMISSIONS.CUSTOMER_EDIT)}
      canCreate={hasPermission(perms, PERMISSIONS.CUSTOMER_CREATE)}
    />
  );
}
