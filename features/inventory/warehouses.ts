'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { getOrganizationEntitlements } from '@/lib/billing/entitlements';
import { getPlanLimit } from '@/lib/billing/plans';
import { WarehouseStatus } from '@/lib/generated/prisma/enums';
import { canUseStore, requireStoreAccess } from '@/lib/store-access';
import { type ActionResult, toActionError } from './shared';

export type WarehouseRow = {
  id: string;
  name: string;
  location: string | null;
  status: WarehouseStatus;
  sellsOnline: boolean;
  itemCount: number;
  /**
   * Whether the signed-in member may change stock here (ROADMAP Phase 8.6).
   * Every row is still returned — seeing that Port Harcourt has three left is
   * how a clerk tells a customer where to go — but a store picker on a form
   * that WRITES should offer only the ones where this is true.
   */
  canWorkHere: boolean;
};

const WarehouseSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  location: z.string().max(200).optional(),
});

export async function listWarehouses(): Promise<ActionResult<WarehouseRow[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_VIEW);

    const warehouses = await prisma.warehouse.findMany({
      where: { organizationId: ctx.organization.id },
      select: {
        id: true,
        name: true,
        location: true,
        status: true,
        sellsOnline: true,
        _count: { select: { inventoryLevels: true } },
      },
      orderBy: { name: 'asc' },
    });

    return {
      success: true,
      data: warehouses.map((w) => ({
        id: w.id,
        name: w.name,
        location: w.location,
        status: w.status,
        sellsOnline: w.sellsOnline,
        itemCount: w._count.inventoryLevels,
        canWorkHere: canUseStore(ctx.membership, w.id),
      })),
    };
  } catch (err) {
    return toActionError(err, 'Failed to load stores');
  }
}

export async function createWarehouse(
  input: z.infer<typeof WarehouseSchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_CREATE);

    const data = WarehouseSchema.parse(input);

    const { plan } = await getOrganizationEntitlements();
    const maxWarehouses = getPlanLimit(plan, 'maxWarehouses');
    if (maxWarehouses !== null) {
      const activeCount = await prisma.warehouse.count({
        where: { organizationId: ctx.organization.id, status: WarehouseStatus.ACTIVE },
      });
      if (activeCount >= maxWarehouses) {
        return {
          success: false,
          error: `Your plan allows up to ${maxWarehouses} store${maxWarehouses === 1 ? '' : 's'}. Upgrade to add more.`,
        };
      }
    }

    const warehouse = await prisma.warehouse.create({
      data: {
        organizationId: ctx.organization.id,
        name: data.name,
        location: data.location,
      },
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'inventory.warehouse.created',
      entityType: 'Warehouse',
      entityId: warehouse.id,
      metadata: { name: data.name },
    });

    return { success: true, data: { id: warehouse.id } };
  } catch (err) {
    return toActionError(err, 'Failed to create store');
  }
}

export async function updateWarehouse(
  warehouseId: string,
  input: z.infer<typeof WarehouseSchema> & { status?: WarehouseStatus },
): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_EDIT);

    const data = WarehouseSchema.parse(input);

    const existing = await prisma.warehouse.findUnique({
      where: { id: warehouseId },
      select: { organizationId: true },
    });
    if (!existing || existing.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Store not found' };
    }
    requireStoreAccess(ctx.membership, warehouseId);

    await prisma.warehouse.update({
      where: { id: warehouseId },
      data: {
        name: data.name,
        location: data.location,
        status: input.status,
      },
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'inventory.warehouse.updated',
      entityType: 'Warehouse',
      entityId: warehouseId,
    });

    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to update store');
  }
}

/** Choose whether the online store sells this store's available stock. */
export async function setWarehouseSellsOnline(warehouseId: string, sellsOnline: boolean): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_EDIT);

    const existing = await prisma.warehouse.findFirst({
      where: { id: warehouseId, organizationId: ctx.organization.id },
      select: { name: true, status: true },
    });
    if (!existing) return { success: false, error: 'Store not found' };
    requireStoreAccess(ctx.membership, warehouseId, existing.name);
    if (sellsOnline && existing.status !== WarehouseStatus.ACTIVE) {
      return { success: false, error: 'Reactivate this store before selling its stock online.' };
    }

    await prisma.warehouse.update({ where: { id: warehouseId }, data: { sellsOnline } });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'inventory.warehouse.sells_online_changed',
      entityType: 'Warehouse',
      entityId: warehouseId,
      metadata: { sellsOnline },
    });

    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to update store');
  }
}
