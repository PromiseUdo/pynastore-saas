'use server';

import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { getOrganizationEntitlements, hasFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { getLowStockLevels } from '@/features/inventory/reports';
import { type ActionResult, toActionError } from './shared';
import { createPurchaseOrder } from './purchase-orders';

export type ReorderDraftItem = {
  inventoryItemId: string;
  itemName: string;
  sku: string;
  quantity: number;
  currentStock: number;
  reorderPoint: number;
};

export type ReorderDraftGroup = {
  warehouseId: string;
  warehouseName: string;
  supplierId: string;
  supplierName: string;
  items: ReorderDraftItem[];
};

export async function previewReorderDrafts(): Promise<ActionResult<ReorderDraftGroup[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.PROCUREMENT_VIEW);

    const lowStock = await getLowStockLevels();
    if (!lowStock.success) return lowStock;

    const candidates = lowStock.data.filter((r) => r.preferredSupplierId);
    if (candidates.length === 0) {
      return { success: true, data: [] };
    }

    const supplierIds = [...new Set(candidates.map((r) => r.preferredSupplierId!))];
    const suppliers = await prisma.supplier.findMany({
      where: { id: { in: supplierIds }, organizationId: ctx.organization.id },
      select: { id: true, name: true },
    });
    const supplierMap = new Map(suppliers.map((s) => [s.id, s.name]));

    const groups = new Map<string, ReorderDraftGroup>();
    for (const row of candidates) {
      const supplierId = row.preferredSupplierId!;
      const supplierName = supplierMap.get(supplierId);
      if (!supplierName) continue; // supplier belongs to another org or was deleted

      const key = `${row.warehouseId}:${supplierId}`;
      if (!groups.has(key)) {
        groups.set(key, {
          warehouseId: row.warehouseId,
          warehouseName: row.warehouseName,
          supplierId,
          supplierName,
          items: [],
        });
      }
      const suggestedQty = row.reorderQty ?? Math.max(row.reorderPoint * 2 - row.quantity, 1);
      groups.get(key)!.items.push({
        inventoryItemId: row.itemId,
        itemName: row.itemName,
        sku: row.sku,
        quantity: Math.ceil(suggestedQty),
        currentStock: row.quantity,
        reorderPoint: row.reorderPoint,
      });
    }

    return { success: true, data: [...groups.values()] };
  } catch (err) {
    return toActionError(err, 'Failed to load reorder suggestions');
  }
}

export async function generateReorderDrafts(
  groups: { warehouseId: string; supplierId: string; items: { inventoryItemId: string; quantity: number }[] }[],
): Promise<ActionResult<{ createdPoIds: string[] }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.PROCUREMENT_CREATE);

    const { plan } = await getOrganizationEntitlements();
    if (!hasFeature(plan, FEATURES.PROCUREMENT_AUTO_REORDER)) {
      return { success: false, error: 'Automatic reorder drafts require the Pro plan or higher' };
    }

    const itemIds = groups.flatMap((g) => g.items.map((i) => i.inventoryItemId));
    const items = await prisma.inventoryItem.findMany({
      where: { id: { in: itemIds }, organizationId: ctx.organization.id },
      select: { id: true, name: true, sku: true, averageCost: true },
    });
    const itemMap = new Map(items.map((i) => [i.id, i]));

    const createdPoIds: string[] = [];
    for (const group of groups) {
      const lineItems = group.items
        .map((gi) => {
          const item = itemMap.get(gi.inventoryItemId);
          if (!item) return null;
          return {
            inventoryItemId: item.id,
            description: `${item.name} (${item.sku})`,
            quantity: gi.quantity,
            unitPrice: Number(item.averageCost),
          };
        })
        .filter((li): li is NonNullable<typeof li> => li !== null);

      if (lineItems.length === 0) continue;

      const result = await createPurchaseOrder({
        supplierId: group.supplierId,
        warehouseId: group.warehouseId,
        currency: 'USD',
        notes: 'Auto-drafted from low-stock reorder suggestions',
        lineItems,
      });

      if (result.success) createdPoIds.push(result.data.id);
    }

    return { success: true, data: { createdPoIds } };
  } catch (err) {
    return toActionError(err, 'Failed to generate reorder drafts');
  }
}
