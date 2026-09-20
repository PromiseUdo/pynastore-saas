// features/procurement/shared.ts
// Shared types/helpers for the procurement feature's server actions.
// Mirrors features/inventory/shared.ts.

import { prisma } from '@/lib/prisma';

export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export function toActionError(err: unknown, fallback: string): ActionResult<never> {
  if (err instanceof Error && err.name === 'PermissionDeniedError') {
    return { success: false, error: 'You do not have permission to do this' };
  }
  console.error(`[procurement] ${fallback}:`, err);
  return { success: false, error: fallback };
}

/**
 * Human-readable sequential PO number, e.g. PO-2026-0001. Shared by
 * purchase-orders.ts and features/sales/invoices.ts (drop-ship lines
 * generate a PO directly at invoice-issue time).
 */
export async function generatePoNumber(organizationId: string): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.purchaseOrder.count({
    where: { organizationId, poNumber: { startsWith: `PO-${year}-` } },
  });
  return `PO-${year}-${String(count + 1).padStart(4, '0')}`;
}
