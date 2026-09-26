// features/inventory/shared.ts
// Shared types/helpers for the inventory feature's server actions.

import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/lib/permissions';
import { sendLowStockAlertEmail } from '@/lib/email';
import { getAdminUrl } from '@/lib/tenant/urls';

export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export function toActionError(err: unknown, fallback: string): ActionResult<never> {
  /* A store the member may not work in — the message already says what to do
   * about it, so it is passed through rather than flattened (Phase 8.6). */
  if (err instanceof Error && err.name === 'StoreAccessDeniedError') {
    return { success: false, error: err.message };
  }
  if (err instanceof Error && err.name === 'PermissionDeniedError') {
    return { success: false, error: 'You do not have permission to do this' };
  }
  if (err instanceof Error && err.name === 'UsageLimitExceededError') {
    return { success: false, error: err.message };
  }
  console.error(`[inventory] ${fallback}:`, err);
  return { success: false, error: fallback };
}

/**
 * On-hand quantity minus whatever's soft-reserved by an issued-but-not-yet-packed
 * invoice (InventoryLevel.reservedQty — see features/sales/invoices.ts:issueInvoice
 * and features/sales/fulfillment.ts:recordPacked). Every action that takes stock
 * out for a reason OTHER than fulfilling that specific reservation — manual OUT
 * movements, transfers, kit assembly — must check this instead of raw `quantity`,
 * or it can silently take stock that's already promised to a customer's order.
 * Accepts either the top-level `prisma` client or a `$transaction` callback's
 * `tx`, since callers check availability both inside and outside transactions.
 */
export async function getAvailableStock(
  client: Pick<typeof prisma, 'inventoryLevel'>,
  params: { inventoryItemId: string; warehouseId: string },
): Promise<{ quantity: number; reservedQty: number; available: number }> {
  const level = await client.inventoryLevel.findUnique({
    where: {
      inventoryItemId_warehouseId: {
        inventoryItemId: params.inventoryItemId,
        warehouseId: params.warehouseId,
      },
    },
  });
  const quantity = level ? Number(level.quantity) : 0;
  const reservedQty = level ? Number(level.reservedQty) : 0;
  return { quantity, reservedQty, available: quantity - reservedQty };
}

/**
 * Weighted moving-average cost after receiving `incomingQty` units at
 * `incomingUnitCost`, given the item's current org-wide quantity/cost.
 * Shared by features/inventory/stock.ts and features/procurement/purchase-orders.ts
 * so the formula only lives in one place.
 */
/**
 * A variant's options as one line: "Red · M". Used wherever a stocked unit is
 * shown under its product's name (a store's stock list, the picker that adds
 * products to a store).
 */
export function variantNameOf(attributes: unknown): string | null {
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) return null;
  const values = Object.values(attributes as Record<string, unknown>).filter((v): v is string => typeof v === 'string');
  return values.length ? values.join(' · ') : null;
}

export function computeMovingAverageCost(
  currentAvgCost: number,
  currentTotalQty: number,
  incomingQty: number,
  incomingUnitCost: number,
): number {
  if (currentTotalQty <= 0) return incomingUnitCost;
  return (currentAvgCost * currentTotalQty + incomingUnitCost * incomingQty) / (currentTotalQty + incomingQty);
}

/**
 * Edge-triggered low-stock email: fires only when `previousQty` was above
 * `threshold` and `newQty` is now at or below it. No cron/background worker
 * in this app — every store-quantity decrease evaluates this inline.
 * Shared by features/inventory/stock.ts, features/inventory/cycle-counts.ts,
 * features/sales/fulfillment.ts and lib/storefront/orders/lifecycle.ts.
 *
 * Stock is per store and so is the threshold, so the mail goes to the store
 * that ran low, not to the org-wide reports page (ROADMAP Phase 8.3) — and it
 * says WHOSE reorder point was crossed, since a merchant who set 10 for Lagos
 * should not have to guess why an alert arrived at 4.
 */
export async function maybeSendLowStockAlert(params: {
  organizationId: string;
  organizationSlug: string;
  itemName: string;
  itemSku: string;
  warehouseId: string;
  warehouseName: string;
  previousQty: number;
  newQty: number;
  threshold: number | null;
}): Promise<void> {
  const { organizationId, organizationSlug, itemName, itemSku, warehouseId, warehouseName, previousQty, newQty, threshold } = params;
  if (threshold === null || previousQty <= threshold || newQty > threshold) return;

  const recipients = await prisma.membership.findMany({
    where: {
      organizationId,
      status: 'ACTIVE',
      role: {
        rolePermissions: {
          some: { permission: { key: PERMISSIONS.INVENTORY_CREATE } },
        },
      },
    },
    select: { user: { select: { email: true } } },
  });

  await sendLowStockAlertEmail({
    to: recipients.map((r) => r.user.email).filter((e): e is string => !!e),
    itemName,
    sku: itemSku,
    warehouseName,
    quantity: newQty,
    reorderPoint: threshold,
    thresholdSource: await thresholdSourceFor(warehouseId, params),
    storeUrl: getAdminUrl(organizationSlug, `/inventory/warehouses/${warehouseId}?tab=inventory&stock=low`),
  });
}

/**
 * Whether the threshold that just fired is this store's own override or the
 * product's, read from the level itself so no caller has to remember to say.
 * Unknown (a level that has since gone) reads as the product's, which is the
 * one every store shares.
 */
async function thresholdSourceFor(
  warehouseId: string,
  params: { itemSku: string; organizationId: string },
): Promise<'store' | 'product'> {
  const level = await prisma.inventoryLevel.findFirst({
    where: {
      warehouseId,
      inventoryItem: { sku: params.itemSku, organizationId: params.organizationId },
    },
    select: { reorderPoint: true },
  });
  return level?.reorderPoint === null || level?.reorderPoint === undefined ? 'product' : 'store';
}
