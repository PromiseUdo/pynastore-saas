/*
 * Sales → Discount codes.
 *
 * The codes shoppers can type at checkout. Checkout resolves against exactly
 * these records (lib/storefront/discounts/) — nothing is built in, so a store
 * with no codes here has no codes at all.
 */
import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { AccessDenied } from '@/components/layout/access-denied';
import { listDiscountCodes } from '@/features/sales/discounts';
import { DiscountsPageClient } from './_components/DiscountsPageClient';

export const metadata: Metadata = { title: 'Discount codes' };

export default async function DiscountsPage() {
  await requireFeature(FEATURES.SALES_MODULE);
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;
  if (!hasPermission(perms, PERMISSIONS.SALES_VIEW)) return <AccessDenied what="discount codes" />;

  const result = await listDiscountCodes();
  if (!result.success) throw new Error(result.error);

  return (
    <DiscountsPageClient
      codes={result.data}
      canManage={hasPermission(perms, PERMISSIONS.SALES_DISCOUNT_MANAGE)}
    />
  );
}
