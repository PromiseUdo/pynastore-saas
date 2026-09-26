// lib/inventory-labels.ts
// The words and colours the ledger is shown with, in one place: the movements
// list, the inventory landing page and a store's own page all label a movement
// identically (AGENTS §6 — never a raw enum, §9 — extract on the second use).
// Plain module, no 'use server': these are constants, not actions.

import type { MovementType } from '@/lib/generated/prisma/enums';

export type MovementBadgeVariant = 'success' | 'destructive' | 'info' | 'warning';

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  IN: 'Stock in',
  OUT: 'Stock out',
  TRANSFER: 'Transfer',
  ADJUSTMENT: 'Adjustment',
  RESERVED: 'Reserved',
};

export const MOVEMENT_VARIANT: Record<MovementType, MovementBadgeVariant> = {
  IN: 'success',
  OUT: 'destructive',
  TRANSFER: 'info',
  ADJUSTMENT: 'warning',
  RESERVED: 'warning',
};

/** What created the movement, in words a shop owner uses. The keys are the
 *  `referenceType` values the app actually writes (see features/*). */
export const MOVEMENT_SOURCE_LABEL: Record<string, string> = {
  PurchaseOrder: 'Purchase order',
  Invoice: 'Customer order',
  Order: 'Customer order',
  StockTransfer: 'Store transfer',
  CycleCount: 'Stock count',
  KitAssembly: 'Kit assembly',
  Return: 'Customer return',
  Requisition: 'Requisition',
};

/** Why a movement happened: the document it came from, then the note. */
export function movementReason(movement: { referenceType: string | null; notes: string | null }): string {
  if (movement.referenceType) {
    const label = MOVEMENT_SOURCE_LABEL[movement.referenceType] ?? movement.referenceType;
    return movement.notes ? `${label} · ${movement.notes}` : label;
  }
  return movement.notes ?? 'Recorded by hand';
}

/** The sign a quantity is shown with: stock in adds, stock out takes away. */
export function movementSign(type: MovementType): string {
  if (type === 'IN') return '+';
  if (type === 'OUT') return '−';
  return '';
}
