'use server';

// Stockable units — what stock movements, transfers, counts and sales/purchase
// documents pick from. Product create/edit lives in ./products.ts.

import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { ItemStatus, ItemType } from '@/lib/generated/prisma/enums';
import { type ActionResult, toActionError } from './shared';

export type ItemListRow = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  barcode: string | null;
  itemType: ItemType;
  status: ItemStatus;
  categoryId: string | null;
  categoryName: string | null;
  reorderPoint: number | null;
  averageCost: number;
  sellingPrice: number | null;
  variantCount: number;
  totalQuantity: number;
  preferredSupplierId: string | null;
  preferredSupplierName: string | null;
};

/**
 * Everything that can physically hold stock: products without variants,
 * each active variant (named "Tee (Red / M)"), and kits — never a parent
 * product that has variants, since its stock lives on the variants. This is
 * what stock movements, transfers, counts, quotes, invoices and purchase
 * orders pick from. A variant's price falls back to its parent's.
 */
export async function listStockableItems(): Promise<ActionResult<ItemListRow[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_VIEW);

    const items = await prisma.inventoryItem.findMany({
      where: {
        organizationId: ctx.organization.id,
        status: { not: ItemStatus.ARCHIVED },
        OR: [
          { itemType: ItemType.KIT },
          { itemType: ItemType.STANDARD, parentItemId: null, variants: { none: { status: { not: ItemStatus.ARCHIVED } } } },
          { itemType: ItemType.VARIANT, parentItem: { status: { not: ItemStatus.ARCHIVED } } },
        ],
      },
      select: {
        id: true,
        sku: true,
        name: true,
        unit: true,
        barcode: true,
        itemType: true,
        status: true,
        categoryId: true,
        category: { select: { name: true } },
        reorderPoint: true,
        averageCost: true,
        sellingPrice: true,
        preferredSupplierId: true,
        preferredSupplier: { select: { name: true } },
        parentItem: { select: { sellingPrice: true } },
        inventoryLevels: { select: { quantity: true } },
      },
      orderBy: { name: 'asc' },
    });

    return {
      success: true,
      data: items.map((item) => {
        const price = item.sellingPrice ?? item.parentItem?.sellingPrice ?? null;
        return {
          id: item.id,
          sku: item.sku,
          name: item.name,
          unit: item.unit,
          barcode: item.barcode,
          itemType: item.itemType,
          status: item.status,
          categoryId: item.categoryId,
          categoryName: item.category?.name ?? null,
          reorderPoint: item.reorderPoint ? Number(item.reorderPoint) : null,
          averageCost: Number(item.averageCost),
          sellingPrice: price ? Number(price) : null,
          variantCount: 0,
          totalQuantity: item.inventoryLevels.reduce((sum, l) => sum + Number(l.quantity), 0),
          preferredSupplierId: item.preferredSupplierId,
          preferredSupplierName: item.preferredSupplier?.name ?? null,
        };
      }),
    };
  } catch (err) {
    return toActionError(err, 'Failed to load items');
  }
}
