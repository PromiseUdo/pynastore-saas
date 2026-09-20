import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { AccessDenied } from '@/components/layout/access-denied';
import { getStockMovements, listStockableItems, listWarehouses, type MovementListParams } from '@/features/inventory/actions';
import { MovementType } from '@/lib/generated/prisma/enums';
import { MovementsPageClient } from './_components/MovementsPageClient';

export const metadata: Metadata = { title: 'Stock movements' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v || undefined);
const isDate = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

function parseParams(raw: Record<string, string | string[] | undefined>): MovementListParams {
  const type = one(raw.type);
  const page = Number(one(raw.page));
  return {
    q: one(raw.q),
    warehouseId: one(raw.store),
    type: type && type in MovementType ? (type as MovementType) : undefined,
    from: isDate(one(raw.from)),
    to: isDate(one(raw.to)),
    page: Number.isFinite(page) && page > 0 ? page : 1,
    perPage: 25,
  };
}

export default async function MovementsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireFeature(FEATURES.INVENTORY_MODULE);
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;
  if (!hasPermission(perms, PERMISSIONS.INVENTORY_VIEW)) return <AccessDenied what="stock movements" />;

  const params = parseParams(await searchParams);
  const [movements, items, warehouses] = await Promise.all([
    getStockMovements(params),
    listStockableItems(),
    listWarehouses(),
  ]);
  if (!movements.success) throw new Error(movements.error);

  return (
    <MovementsPageClient
      result={movements.data}
      params={params}
      items={items.success ? items.data : []}
      warehouses={warehouses.success ? warehouses.data : []}
      canRecord={hasPermission(perms, PERMISSIONS.INVENTORY_MOVEMENT_CREATE)}
    />
  );
}
