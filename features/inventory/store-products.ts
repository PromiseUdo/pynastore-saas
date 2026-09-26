'use server';

/*
 * features/inventory/store-products.ts
 *
 * Managing a store's products FROM the store (ROADMAP Phase 8.2). Until now
 * assignment only happened one product at a time on the product form, so
 * stocking a new shop meant editing every product in the catalogue.
 *
 * Two things this file will not do:
 *
 * - It never writes a quantity of its own. Opening stock goes through
 *   `recordStockIn` → `createStockMovement`, so the ledger, the moving-average
 *   cost and the low-stock alert behave exactly as they do when a purchase
 *   order is received. The only `InventoryLevel` row it creates by hand is an
 *   empty one (quantity 0) — which says "this store carries this product",
 *   and moves nothing.
 * - It never deletes a level that has history. A ledger entry pointing at a
 *   level that no longer exists makes the history unreadable, so a product
 *   that has ever moved here keeps its row at zero.
 */

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { requireStoreAccess } from '@/lib/store-access';
import { ItemStatus } from '@/lib/generated/prisma/enums';
import { type ActionResult, toActionError, variantNameOf } from './shared';
import { recordStockIn } from './stock';

/** A catalogue product this store doesn't carry yet. */
export type StoreCandidateRow = {
  /** The stocked unit — a variant where the product has options. */
  itemId: string;
  name: string;
  variantName: string | null;
  sku: string;
  status: ItemStatus;
  /** Available in the merchant's other stores, so they can send some over instead. */
  availableElsewhere: number;
  otherStoreCount: number;
};

const CANDIDATE_LIMIT = 25;

/**
 * Products that could be added to this store: searched, and never one it
 * already carries. A product with options is offered as its variants, since a
 * quantity belongs to a variant.
 */
export async function searchStoreCandidates(input: { warehouseId: string; q?: string }): Promise<ActionResult<StoreCandidateRow[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_VIEW);
    const organizationId = ctx.organization.id;

    const store = await prisma.warehouse.findFirst({
      where: { id: input.warehouseId, organizationId },
      select: { id: true },
    });
    if (!store) return { success: false, error: 'Store not found' };

    const q = input.q?.trim();

    const items = await prisma.inventoryItem.findMany({
      where: {
        organizationId,
        status: { not: ItemStatus.ARCHIVED },
        // A parent with options isn't stocked itself; its variants are.
        variants: { none: {} },
        // Already carried here — nothing to add.
        inventoryLevels: { none: { warehouseId: input.warehouseId } },
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { sku: { contains: q, mode: 'insensitive' } },
                { barcode: { contains: q, mode: 'insensitive' } },
                { parentItem: { name: { contains: q, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        sku: true,
        status: true,
        parentItemId: true,
        variantAttributes: true,
        parentItem: { select: { name: true } },
        inventoryLevels: { select: { quantity: true, reservedQty: true } },
      },
      orderBy: [{ name: 'asc' }],
      take: CANDIDATE_LIMIT,
    });

    return {
      success: true,
      data: items.map((item) => {
        const elsewhere = item.inventoryLevels.reduce((sum, l) => sum + Math.max(0, Number(l.quantity) - Number(l.reservedQty)), 0);
        return {
          itemId: item.id,
          name: item.parentItem?.name ?? item.name,
          variantName: item.parentItemId ? (variantNameOf(item.variantAttributes) ?? item.name) : null,
          sku: item.sku,
          status: item.status,
          availableElsewhere: elsewhere,
          otherStoreCount: item.inventoryLevels.length,
        };
      }),
    };
  } catch (err) {
    return toActionError(err, 'Failed to search your products');
  }
}

const AssignSchema = z.object({
  warehouseId: z.string().cuid(),
  lines: z
    .array(
      z.object({
        inventoryItemId: z.string().cuid(),
        /** Opening stock. Omitted or 0 = carried here, none on the shelf yet. */
        quantity: z.number().nonnegative().max(1_000_000, 'That quantity is too large').optional(),
        /** What a unit cost, so the average cost stays honest. */
        unitCost: z.number().nonnegative().max(1_000_000_000).optional(),
      }),
    )
    .min(1, 'Choose at least one product')
    .max(100, 'Add up to 100 products at a time'),
});

export type AssignProductsInput = z.input<typeof AssignSchema>;

export type AssignProductsResult = {
  /** Products this store now carries that it didn't before. */
  added: number;
  /** Of those, how many arrived with opening stock. */
  withOpeningStock: number;
  /** Already carried here — left exactly as they were. */
  alreadyStocked: number;
};

/**
 * Add products to this store. Products it already carries are skipped rather
 * than reset, so pressing the button twice cannot wipe a quantity.
 *
 * An opening quantity needs `inventory.movement.create` on top of
 * `inventory.edit`, because it writes to the ledger — a member who may tidy
 * the catalogue is not automatically a member who may declare stock.
 */
export async function assignProductsToStore(input: AssignProductsInput): Promise<ActionResult<AssignProductsResult>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_EDIT);
    const organizationId = ctx.organization.id;

    const parsed = AssignSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Please check the form' };
    const data = parsed.data;

    const opening = data.lines.filter((line) => (line.quantity ?? 0) > 0);
    if (opening.length > 0 && !hasPermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_MOVEMENT_CREATE)) {
      return { success: false, error: 'You can add products to a store, but not record stock. Leave the quantities empty, or ask an admin.' };
    }

    const store = await prisma.warehouse.findFirst({
      where: { id: data.warehouseId, organizationId },
      select: { id: true, name: true, status: true },
    });
    if (!store) return { success: false, error: 'Store not found' };
    if (store.status !== 'ACTIVE') {
      return { success: false, error: `${store.name} is closed. Reopen it before adding products.` };
    }
    requireStoreAccess(ctx.membership, data.warehouseId, store.name);

    // Every id is checked against THIS org, so a foreign one is simply not found.
    const ids = [...new Set(data.lines.map((line) => line.inventoryItemId))];
    const items = await prisma.inventoryItem.findMany({
      where: { id: { in: ids }, organizationId, status: { not: ItemStatus.ARCHIVED } },
      select: { id: true, variants: { select: { id: true }, take: 1 } },
    });
    if (items.length !== ids.length) {
      return { success: false, error: 'One of those products is no longer in your catalogue. Reload the page and try again.' };
    }
    const withOptions = items.find((item) => item.variants.length > 0);
    if (withOptions) {
      return { success: false, error: 'Products with options are stocked per option. Choose the options instead of the product.' };
    }

    const existing = await prisma.inventoryLevel.findMany({
      where: { warehouseId: data.warehouseId, inventoryItemId: { in: ids } },
      select: { inventoryItemId: true },
    });
    const alreadyStocked = new Set(existing.map((level) => level.inventoryItemId));

    const toAdd = data.lines.filter((line) => !alreadyStocked.has(line.inventoryItemId));
    if (toAdd.length === 0) {
      return { success: true, data: { added: 0, withOpeningStock: 0, alreadyStocked: alreadyStocked.size } };
    }

    // The empty row first: it is what "this store carries this" means, and it
    // makes the product show up here even if the stock-in below is refused.
    await prisma.inventoryLevel.createMany({
      data: toAdd.map((line) => ({ inventoryItemId: line.inventoryItemId, warehouseId: data.warehouseId, quantity: 0 })),
      skipDuplicates: true,
    });

    const openingLines = toAdd
      .filter((line) => (line.quantity ?? 0) > 0)
      .map((line) => ({ inventoryItemId: line.inventoryItemId, quantity: line.quantity!, unitCost: line.unitCost }));

    if (openingLines.length > 0) {
      const recorded = await recordStockIn({
        warehouseId: data.warehouseId,
        lines: openingLines,
        notes: 'Opening stock',
      });
      if (!recorded.success) {
        // The products are on the store's list; only the quantities didn't land.
        return {
          success: false,
          error: `${toAdd.length} product${toAdd.length === 1 ? '' : 's'} added to ${store.name}, but the opening stock wasn’t recorded: ${recorded.error}`,
        };
      }
    }

    await createAuditLog({
      organizationId,
      userId: ctx.userId,
      action: 'inventory.warehouse.products_added',
      entityType: 'Warehouse',
      entityId: data.warehouseId,
      metadata: { added: toAdd.length, withOpeningStock: openingLines.length, alreadyStocked: alreadyStocked.size },
    });

    return {
      success: true,
      data: { added: toAdd.length, withOpeningStock: openingLines.length, alreadyStocked: alreadyStocked.size },
    };
  } catch (err) {
    return toActionError(err, 'Failed to add products to this store');
  }
}

const SettingsSchema = z.object({
  warehouseId: z.string().cuid(),
  inventoryItemId: z.string().cuid(),
  /** null clears the override, so the product's own reorder point applies again. */
  reorderPoint: z.number().nonnegative().max(1_000_000).nullable(),
  reorderQty: z.number().positive().max(1_000_000).nullable(),
  location: z.string().max(100).nullable(),
});

export type StoreStockSettingsInput = z.input<typeof SettingsSchema>;

/**
 * This store's own reorder point, restock quantity and shelf tag for one
 * product. A null reorder point is not "warn me at zero" — it hands the
 * decision back to the product, which every other store already uses.
 */
export async function setStoreStockSettings(input: StoreStockSettingsInput): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_EDIT);
    const organizationId = ctx.organization.id;

    const parsed = SettingsSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Please check the form' };
    const data = parsed.data;

    const level = await prisma.inventoryLevel.findFirst({
      where: {
        inventoryItemId: data.inventoryItemId,
        warehouseId: data.warehouseId,
        warehouse: { organizationId },
        inventoryItem: { organizationId },
      },
      select: { inventoryItemId: true },
    });
    if (!level) return { success: false, error: 'This store doesn’t carry that product' };
    requireStoreAccess(ctx.membership, data.warehouseId);

    const location = data.location?.trim() || null;

    await prisma.inventoryLevel.update({
      where: {
        inventoryItemId_warehouseId: { inventoryItemId: data.inventoryItemId, warehouseId: data.warehouseId },
      },
      data: { reorderPoint: data.reorderPoint, reorderQty: data.reorderQty, location },
    });

    await createAuditLog({
      organizationId,
      userId: ctx.userId,
      action: 'inventory.warehouse.stock_settings_updated',
      entityType: 'InventoryLevel',
      entityId: `${data.inventoryItemId}:${data.warehouseId}`,
      metadata: { reorderPoint: data.reorderPoint, reorderQty: data.reorderQty, location },
    });

    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to save these settings');
  }
}

/**
 * Stop carrying a product at this store. Only possible while the shelf is
 * empty, nothing is held for an order and nothing has ever moved here —
 * otherwise the row stays, because the ledger points at it.
 */
export async function removeProductFromStore(input: {
  warehouseId: string;
  inventoryItemId: string;
}): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_EDIT);
    const organizationId = ctx.organization.id;

    const level = await prisma.inventoryLevel.findFirst({
      where: {
        inventoryItemId: input.inventoryItemId,
        warehouseId: input.warehouseId,
        warehouse: { organizationId },
        inventoryItem: { organizationId },
      },
      select: { quantity: true, reservedQty: true, inventoryItem: { select: { name: true } } },
    });
    if (!level) return { success: false, error: 'This store doesn’t carry that product' };
    requireStoreAccess(ctx.membership, input.warehouseId);

    if (Number(level.quantity) !== 0) {
      return {
        success: false,
        error: 'There is still stock here. Move it to another store or count it out first.',
      };
    }
    if (Number(level.reservedQty) !== 0) {
      return { success: false, error: 'Some of this is held for an order. Finish or cancel that order first.' };
    }

    const movements = await prisma.stockMovement.count({
      where: {
        organizationId,
        inventoryItemId: input.inventoryItemId,
        OR: [{ warehouseId: input.warehouseId }, { toWarehouseId: input.warehouseId }],
      },
    });
    if (movements > 0) {
      return {
        success: false,
        error: `${level.inventoryItem.name} has moved through this store before, so its record stays here at zero. Nothing is on the shelf.`,
      };
    }

    await prisma.inventoryLevel.delete({
      where: {
        inventoryItemId_warehouseId: { inventoryItemId: input.inventoryItemId, warehouseId: input.warehouseId },
      },
    });

    await createAuditLog({
      organizationId,
      userId: ctx.userId,
      action: 'inventory.warehouse.product_removed',
      entityType: 'Warehouse',
      entityId: input.warehouseId,
      metadata: { inventoryItemId: input.inventoryItemId },
    });

    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to remove this product from the store');
  }
}
