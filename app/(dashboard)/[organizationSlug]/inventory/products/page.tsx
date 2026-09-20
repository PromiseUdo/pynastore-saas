import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature, getOrganizationEntitlements, hasFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { AccessDenied } from '@/components/layout/access-denied';
import {
  listProducts,
  listCategories,
  listBrands,
  listWarehouses,
  listStockableItems,
  type ProductListParams,
} from '@/features/inventory/actions';
import { ItemStatus } from '@/lib/generated/prisma/enums';
import { ProductsPageClient } from './_components/ProductsPageClient';

export const metadata: Metadata = { title: 'Products' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value || undefined;
}

/** Reads the URL into list params, dropping anything unrecognised. */
function parseParams(raw: Record<string, string | string[] | undefined>): ProductListParams {
  const status = one(raw.status);
  const online = one(raw.online);
  const stock = one(raw.stock);
  const sort = one(raw.sort);
  const page = Number(one(raw.page));
  return {
    q: one(raw.q),
    categoryId: one(raw.category),
    brandId: one(raw.brand),
    status: status === 'all' || (status && status in ItemStatus) ? (status as ProductListParams['status']) : undefined,
    online: online === 'published' || online === 'draft' ? online : undefined,
    stock: stock === 'in' || stock === 'low' || stock === 'out' ? stock : undefined,
    sort: sort === 'newest' || sort === 'stock-asc' || sort === 'stock-desc' ? sort : undefined,
    page: Number.isFinite(page) && page > 0 ? page : 1,
    perPage: 25,
  };
}

export default async function ProductsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireFeature(FEATURES.INVENTORY_MODULE);
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;

  if (!hasPermission(perms, PERMISSIONS.INVENTORY_VIEW)) return <AccessDenied what="products" />;

  const params = parseParams(await searchParams);
  const [products, categories, brands, warehouses, stockable, { plan }] = await Promise.all([
    listProducts(params),
    listCategories(),
    listBrands(),
    listWarehouses(),
    listStockableItems(),
    getOrganizationEntitlements(),
  ]);
  if (!products.success) throw new Error(products.error);

  return (
    <ProductsPageClient
      result={products.data}
      params={params}
      categories={categories.success ? categories.data : []}
      brands={brands.success ? brands.data : []}
      warehouses={warehouses.success ? warehouses.data : []}
      kitCandidates={stockable.success ? stockable.data.filter((i) => i.itemType !== 'KIT') : []}
      can={{
        create: hasPermission(perms, PERMISSIONS.INVENTORY_CREATE),
        edit: hasPermission(perms, PERMISSIONS.INVENTORY_EDIT),
        assembleKits: hasPermission(perms, PERMISSIONS.INVENTORY_KIT_ASSEMBLE),
        recordStock: hasPermission(perms, PERMISSIONS.INVENTORY_MOVEMENT_CREATE),
      }}
      kitsEnabled={hasFeature(plan, FEATURES.INVENTORY_KITS)}
    />
  );
}
