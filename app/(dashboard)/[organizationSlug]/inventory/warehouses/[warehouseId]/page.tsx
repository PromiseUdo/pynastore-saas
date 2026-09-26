import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature, getOrganizationEntitlements, hasFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { AccessDenied } from '@/components/layout/access-denied';
import { PageBody } from '@/components/layout/page-header';
import {
  getStoreActivity,
  getStoreDetail,
  getStoreInventory,
  getStoreOpenTransfers,
  type StoreInventoryParams,
} from '@/features/inventory/actions';
import { listStoreOrders } from '@/features/sales/orders';
import { getStoreSales } from '@/features/sales/store-sales';
import { startOfMonthInLagos } from '@/lib/day';
import { formatMonth } from '@/lib/format';
import { StoreHeader } from './_components/StoreHeader';
import { StoreOverview } from './_components/StoreOverview';
import { StoreInventoryTable } from './_components/StoreInventoryTable';
import { StoreOrdersTable } from './_components/StoreOrdersTable';

type Props = {
  params: Promise<{ warehouseId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value || undefined);

const NOT_FOUND = 'Store not found';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { warehouseId } = await params;
  const result = await getStoreDetail(warehouseId);
  return { title: result.success ? result.data.name : 'Store' };
}

/** The URL is the state: which tab, and how the stock list is narrowed. */
function parseParams(warehouseId: string, raw: Record<string, string | string[] | undefined>): StoreInventoryParams {
  const stock = one(raw.stock);
  const sort = one(raw.sort);
  const page = Number(one(raw.page));
  return {
    warehouseId,
    q: one(raw.q),
    stock: stock === 'in' || stock === 'low' || stock === 'out' ? stock : undefined,
    sort: sort === 'stock-asc' || sort === 'stock-desc' || sort === 'value-desc' || sort === 'name' ? sort : undefined,
    page: Number.isFinite(page) && page > 0 ? page : 1,
    perPage: 25,
  };
}

export default async function StorePage({ params, searchParams }: Props) {
  await requireFeature(FEATURES.INVENTORY_MODULE);
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;
  if (!hasPermission(perms, PERMISSIONS.INVENTORY_VIEW)) return <AccessDenied what="stores" />;

  const { warehouseId } = await params;
  const raw = await searchParams;
  /* Orders need `sales.view`; without it the tab isn't offered and a
     hand-typed `?tab=orders` falls back to the overview rather than to an
     access-denied page inside a store. */
  const canSeeOrders = hasPermission(perms, PERMISSIONS.SALES_VIEW);
  const requestedTab = one(raw.tab);
  const tab =
    requestedTab === 'inventory' ? 'inventory' : requestedTab === 'orders' && canSeeOrders ? 'orders' : 'overview';

  const store = await getStoreDetail(warehouseId);
  if (!store.success) {
    if (store.error === NOT_FOUND) notFound();
    throw new Error(store.error);
  }

  const header = (
    <StoreHeader
      store={store.data}
      tab={tab}
      /* The permission says what, the store access says where — both are
         needed to change this store (ROADMAP Phase 8.6). */
      canEdit={hasPermission(perms, PERMISSIONS.INVENTORY_EDIT) && store.data.canWorkHere}
      showOrders={canSeeOrders}
    />
  );

  if (tab === 'inventory') {
    const listParams = parseParams(warehouseId, raw);
    const inventory = await getStoreInventory(listParams);
    if (!inventory.success) {
      if (inventory.error === NOT_FOUND) notFound();
      throw new Error(inventory.error);
    }
    return (
      <>
        {header}
        <StoreInventoryTable
          storeName={store.data.name}
          storeIsOpen={store.data.status === 'ACTIVE'}
          result={inventory.data}
          params={listParams}
          can={{
            edit: hasPermission(perms, PERMISSIONS.INVENTORY_EDIT) && store.data.canWorkHere,
            recordStock: hasPermission(perms, PERMISSIONS.INVENTORY_MOVEMENT_CREATE) && store.data.canWorkHere,
          }}
        />
      </>
    );
  }

  if (tab === 'orders') {
    const page = Number(one(raw.page));
    /* The same read the Sales list uses, narrowed to this store and turned
       around: oldest first, because that customer has waited longest. */
    const orders = await listStoreOrders({
      warehouseId,
      status: one(raw.status),
      sort: 'oldest',
      page: Number.isFinite(page) && page > 0 ? page : 1,
    });
    if (!orders.success) throw new Error(orders.error);
    return (
      <>
        {header}
        <StoreOrdersTable storeName={store.data.name} list={orders.data} />
      </>
    );
  }

  /* The overview's "running low" panel is the same read as the Inventory tab,
     sorted worst-first — so the two can't disagree about what is low here. */
  /* This month is the merchant's month (Africa/Lagos), not the server's — the
     same boundary the dashboard's "today" figures use. */
  const monthStart = startOfMonthInLagos();
  const [activity, transfers, worstFirst, { plan }, monthSales] = await Promise.all([
    getStoreActivity(warehouseId),
    getStoreOpenTransfers(warehouseId),
    getStoreInventory({ warehouseId, sort: 'stock-asc', perPage: 6 }),
    getOrganizationEntitlements(),
    canSeeOrders ? getStoreSales({ warehouseId, from: monthStart, to: new Date() }) : null,
  ]);

  const runningLow = worstFirst.success ? worstFirst.data.rows.filter((row) => row.stockState !== 'in') : [];

  /* Restocking lives in Procurement. The suggestions page is a Pro feature, so
     a workspace without it is pointed at purchase orders — which every plan
     with the procurement module has — plus what Pro would add (AGENTS §7). */
  const canSeeProcurement =
    hasPermission(perms, PERMISSIONS.PROCUREMENT_VIEW) && hasFeature(plan, FEATURES.PROCUREMENT_MODULE);
  const hasSuggestions = hasFeature(plan, FEATURES.PROCUREMENT_AUTO_REORDER);
  const restock = canSeeProcurement
    ? hasSuggestions
      ? { href: `/procurement/reorder?store=${warehouseId}`, label: `Review restocking for ${store.data.name}`, upgradeHint: false }
      : { href: '/procurement/purchase-orders', label: 'Order more', upgradeHint: true }
    : null;

  /* Comparing stores is part of the Pro reports, so the link is only offered
     where it leads somewhere (AGENTS §7 — and the store's own figures above
     are not gated). */
  const comparisonHref =
    hasFeature(plan, FEATURES.REPORTS_ADVANCED) && hasPermission(perms, PERMISSIONS.INVENTORY_VIEW)
      ? '/inventory/reports/advanced?view=by-store'
      : null;

  return (
    <>
      {header}
      <PageBody className="space-y-6">
        <StoreOverview
          store={store.data}
          activity={activity.success ? activity.data : []}
          transfers={transfers.success ? transfers.data : []}
          runningLow={runningLow}
          restock={restock}
          sales={
            monthSales?.success
              ? { figures: monthSales.data, monthLabel: formatMonth(monthStart), comparisonHref }
              : null
          }
        />
      </PageBody>
    </>
  );
}
