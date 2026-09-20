'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { type ActionResult, toActionError } from './shared';

export type PutawayRow = {
  inventoryItemId: string;
  itemName: string;
  sku: string;
  warehouseId: string;
  warehouseName: string;
  quantity: number;
  location: string | null;
};

export async function getPutawayQueue(warehouseId?: string): Promise<ActionResult<PutawayRow[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_VIEW);

    const levels = await prisma.inventoryLevel.findMany({
      where: {
        warehouseId,
        quantity: { gt: 0 },
        inventoryItem: { organizationId: ctx.organization.id },
      },
      select: {
        quantity: true,
        location: true,
        warehouseId: true,
        warehouse: { select: { name: true } },
        inventoryItem: { select: { id: true, name: true, sku: true } },
      },
      orderBy: { inventoryItem: { name: 'asc' } },
    });

    const rows: PutawayRow[] = levels.map((l) => ({
      inventoryItemId: l.inventoryItem.id,
      itemName: l.inventoryItem.name,
      sku: l.inventoryItem.sku,
      warehouseId: l.warehouseId,
      warehouseName: l.warehouse.name,
      quantity: Number(l.quantity),
      location: l.location,
    }));

    // Unlocated rows first — that's the "queue" needing attention.
    rows.sort((a, b) => {
      if (!a.location && b.location) return -1;
      if (a.location && !b.location) return 1;
      return 0;
    });

    return { success: true, data: rows };
  } catch (err) {
    return toActionError(err, 'Failed to load putaway queue');
  }
}

const SetLocationSchema = z.object({
  inventoryItemId: z.string().cuid(),
  warehouseId: z.string().cuid(),
  location: z.string().max(100).optional(),
});

export async function setItemLocation(input: z.infer<typeof SetLocationSchema>): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_EDIT);

    const data = SetLocationSchema.parse(input);

    const [item, warehouse] = await Promise.all([
      prisma.inventoryItem.findUnique({ where: { id: data.inventoryItemId }, select: { organizationId: true } }),
      prisma.warehouse.findUnique({ where: { id: data.warehouseId }, select: { organizationId: true } }),
    ]);
    if (!item || item.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Item not found' };
    }
    if (!warehouse || warehouse.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Store not found' };
    }

    const location = data.location?.trim() || null;

    await prisma.inventoryLevel.upsert({
      where: {
        inventoryItemId_warehouseId: { inventoryItemId: data.inventoryItemId, warehouseId: data.warehouseId },
      },
      create: {
        inventoryItemId: data.inventoryItemId,
        warehouseId: data.warehouseId,
        quantity: 0,
        location,
      },
      update: { location },
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'inventory.putaway.location_set',
      entityType: 'InventoryLevel',
      entityId: `${data.inventoryItemId}:${data.warehouseId}`,
      metadata: { location },
    });

    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to set location');
  }
}
