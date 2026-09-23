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
import { CustomerDetailClient } from './_components/CustomerDetailClient';

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

  return (
    <CustomerDetailClient
      customer={result.data}
      currency={ctx.organization.currency}
      canManage={canManage}
      duplicates={duplicates?.success ? duplicates.data : []}
    />
  );
}
