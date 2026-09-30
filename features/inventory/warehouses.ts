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
import { STORE_PLACE_REQUIRED_MESSAGE, cleanCity, hasStorePlace, storePlaceProblem } from './store-place';

export type WarehouseRow = {
  id: string;
  name: string;
  location: string | null;
  /** Where it is (Phase 9.1) — both or neither; see ./store-place.ts. */
  state: string | null;
  city: string | null;
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
  /** Omitted or blank = no place yet. The pair is checked by storePlaceProblem. */
  state: z.string().max(60).nullish(),
  city: z.string().max(200).nullish(),
});

/**
 * The place as it will be stored, or the reason it can't be. `required` is
 * true for a store that sells online, which may not lose its place.
 */
function parsePlace(
  data: { state?: string | null; city?: string | null },
  required: boolean,
): { ok: true; state: string | null; city: string | null } | { ok: false; error: string } {
  const problem = storePlaceProblem({ state: data.state ?? null, city: data.city ?? null }, required);
  if (problem) return { ok: false, error: problem.message };
  const city = cleanCity(data.city);
  return { ok: true, state: city ? data.state!.trim() : null, city };
}

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
        state: true,
        city: true,
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
        state: w.state,
        city: w.city,
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
    const place = parsePlace(data, false);
    if (!place.ok) return { success: false, error: place.error };

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
        location: data.location?.trim() || null,
        state: place.state,
        city: place.city,
      },
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'inventory.warehouse.created',
      entityType: 'Warehouse',
      entityId: warehouse.id,
      metadata: { name: data.name, state: place.state, city: place.city },
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
      select: { organizationId: true, sellsOnline: true, state: true, city: true },
    });
    if (!existing || existing.organizationId !== ctx.organization.id) {
      return { success: false, error: 'Store not found' };
    }
    requireStoreAccess(ctx.membership, warehouseId);

    /* A store that sells online may not lose its place. One that sold online
     * before places existed may still be saved without one — refusing would
     * lock the merchant out of renaming it — but it can't have one removed. */
    const place = parsePlace(data, existing.sellsOnline && hasStorePlace(existing));
    if (!place.ok) return { success: false, error: place.error };

    /* Every field the form holds is written, blank included: undefined would
     * leave Prisma's old value in place, and clearing the address box would
     * silently do nothing. */
    await prisma.warehouse.update({
      where: { id: warehouseId },
      data: {
        name: data.name,
        location: data.location?.trim() || null,
        state: place.state,
        city: place.city,
        status: input.status,
      },
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'inventory.warehouse.updated',
      entityType: 'Warehouse',
      entityId: warehouseId,
      metadata:
        existing.state !== place.state || existing.city !== place.city
          ? { place: { from: { state: existing.state, city: existing.city }, to: { state: place.state, city: place.city } } }
          : undefined,
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
      select: { name: true, status: true, state: true, city: true },
    });
    if (!existing) return { success: false, error: 'Store not found' };
    requireStoreAccess(ctx.membership, warehouseId, existing.name);
    if (sellsOnline && existing.status !== WarehouseStatus.ACTIVE) {
      return { success: false, error: 'Reactivate this store before selling its stock online.' };
    }
    // Delivery is priced from where a parcel leaves (Phase 9), so an online store needs a place.
    if (sellsOnline && !hasStorePlace(existing)) {
      return { success: false, error: STORE_PLACE_REQUIRED_MESSAGE };
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
