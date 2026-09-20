/*
 * Sales → Orders: what the online store has sold.
 *
 * A read-only list for now. Orders arrive from the storefront
 * (lib/storefront/orders/create.ts) already carrying their delivery address
 * and payment state; moving one along its lifecycle — confirming, packing,
 * invoicing — is the next piece of work and deliberately isn't faked here
 * with buttons that don't do anything.
 */
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { AccessDenied } from '@/components/layout/access-denied';
import { listStoreOrders } from '@/features/sales/orders';
import { OrdersPageClient } from './_components/OrdersPageClient';

export default async function StoreOrdersPage() {
  await requireFeature(FEATURES.SALES_MODULE);
  const ctx = await getOrganizationContext();

  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW)) {
    return <AccessDenied what="online store orders" />;
  }

  const result = await listStoreOrders();

  /*
   * A failed load is thrown, not printed. The boundary next door says
   * something a person can act on and offers a retry; a raw message like
   * "Cannot read properties of undefined" tells a shop owner nothing and
   * leaks our internals onto their screen.
   */
  if (!result.success) throw new Error(result.error);

  return <OrdersPageClient orders={result.data} />;
}
