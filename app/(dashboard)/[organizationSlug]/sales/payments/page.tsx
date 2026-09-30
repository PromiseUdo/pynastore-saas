/*
 * Sales → Payments (ROADMAP 10.6): online payments, and what Paystack did with
 * each — the customer's payment, Paystack's fee, what settles to the shop's
 * bank. Filters and the page live in the URL (AGENTS §3) and become the query.
 */
import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { AccessDenied } from '@/components/layout/access-denied';
import { listOnlinePayments } from '@/features/sales/payments';
import { PaymentsPageClient } from './_components/PaymentsPageClient';

export const metadata: Metadata = { title: 'Payments' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value || undefined;
}

export default async function PaymentsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireFeature(FEATURES.SALES_MODULE);
  const ctx = await getOrganizationContext();
  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW)) {
    return <AccessDenied what="payments" />;
  }

  const raw = await searchParams;
  const page = Number(one(raw.page));
  const result = await listOnlinePayments({
    range: one(raw.range),
    view: one(raw.view),
    q: one(raw.q),
    page: Number.isFinite(page) && page > 0 ? page : 1,
  });
  if (!result.success) throw new Error(result.error);

  return (
    <PaymentsPageClient
      list={result.data}
      canSetUp={hasPermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_EDIT)}
    />
  );
}
