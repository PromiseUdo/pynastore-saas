/*
 * Sales → Orders: everything the business has sold, through any channel.
 *
 * Online orders arrive from the storefront
 * (lib/storefront/orders/create.ts) carrying a delivery address and a
 * payment state; counter sales are rung up here
 * (features/sales/counter-sale.ts) and are already done when they land.
 *
 * Filters, search and the page number live in the URL (AGENTS §3) and are
 * applied by the database.
 */
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { AccessDenied } from '@/components/layout/access-denied';
import { listStoreOrders } from '@/features/sales/orders';
import { listWarehouses } from '@/features/inventory/actions';
import { OrdersPageClient } from './_components/OrdersPageClient';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value || undefined;
}

export default async function StoreOrdersPage({ searchParams }: { searchParams: SearchParams }) {
  await requireFeature(FEATURES.SALES_MODULE);
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;

  if (!hasPermission(perms, PERMISSIONS.SALES_VIEW)) {
    return <AccessDenied what="orders" />;
  }

  const raw = await searchParams;
  const page = Number(one(raw.page));
  /* The store filter covers both channels: a counter sale rung up there, or
     an online order its shelf supplied (ROADMAP Phase 8.4). */
  const [result, warehouses] = await Promise.all([
    listStoreOrders({
      channel: one(raw.channel),
      status: one(raw.status),
      q: one(raw.q),
      warehouseId: one(raw.store),
      page: Number.isFinite(page) && page > 0 ? page : 1,
    }),
    listWarehouses(),
  ]);

  /*
   * A failed load is thrown, not printed. The boundary next door says
   * something a person can act on and offers a retry; a raw message like
   * "Cannot read properties of undefined" tells a shop owner nothing and
   * leaks our internals onto their screen.
   */
  if (!result.success) throw new Error(result.error);

  return (
    <OrdersPageClient
      list={result.data}
      stores={warehouses.success ? warehouses.data.map((w) => ({ id: w.id, name: w.name })) : []}
      canSell={hasPermission(perms, PERMISSIONS.SALES_ORDER_CREATE)}
    />
  );
}
