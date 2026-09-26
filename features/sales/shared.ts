// features/sales/shared.ts
// Shared types/helpers for the sales feature's server actions.
// Mirrors features/inventory/shared.ts and features/procurement/shared.ts.

import { prisma } from '@/lib/prisma';

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
  console.error(`[sales] ${fallback}:`, err);
  return { success: false, error: fallback };
}

/**
 * Human-readable sequential document number, e.g. QT-2026-0001 / INV-2026-0001.
 * Shared by quotes.ts and invoices.ts (converting a quote to an invoice needs
 * both), same pattern as features/procurement/purchase-orders.ts:generatePoNumber.
 */
export async function generateDocumentNumber(
  organizationId: string,
  prefix: string,
  table: 'quote' | 'invoice',
): Promise<string> {
  const year = new Date().getFullYear();
  const startsWith = `${prefix}-${year}-`;
  const count =
    table === 'quote'
      ? await prisma.quote.count({ where: { organizationId, quoteNumber: { startsWith } } })
      : await prisma.invoice.count({ where: { organizationId, invoiceNumber: { startsWith } } });
  return `${startsWith}${String(count + 1).padStart(4, '0')}`;
}
