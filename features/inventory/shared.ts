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
 * Shared by features/inventory/stock.ts and features/inventory/cycle-counts.ts.
 */
export async function maybeSendLowStockAlert(params: {
  organizationId: string;
  organizationSlug: string;
  itemName: string;
  itemSku: string;
  warehouseName: string;
  previousQty: number;
  newQty: number;
  threshold: number | null;
}): Promise<void> {
  const { organizationId, organizationSlug, itemName, itemSku, warehouseName, previousQty, newQty, threshold } = params;
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
    inventoryUrl: getAdminUrl(organizationSlug, '/inventory/reports'),
  });
}
